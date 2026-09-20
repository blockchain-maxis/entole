import { getAddress, isAddress, parseAbi, type Address } from 'viem';
import { z } from 'zod';

import { json, preflight, readJson } from '@/lib/server/http';
import {
  FAUCET_ADDRESS,
  FAUCET_LIMIT_PER_MINUTE,
  TOKEN_ADDRESS,
  getSponsor,
  rateLimit,
  sendSerially,
  sponsorIsLow,
} from '@/lib/server/sponsor';

/**
 * Tops a new account up with test AUSD from Agora's faucet, sent by the
 * sponsor so the person needs no MON for the fee. The faucet mints to any
 * address, so this route only checks its rules first (recipient below the cap,
 * global cooldown elapsed) to answer clearly instead of paying for a revert.
 */
export const runtime = 'nodejs';

const faucetAbi = parseAbi([
  'function requestFunds(address to)',
  'function faucetDripAmount() view returns (uint256)',
  'function maxAmountToOwn() view returns (uint256)',
  'function maxDripFrequency() view returns (uint256)',
  'function lastDripTimestamp() view returns (uint256)',
]);
const tokenAbi = parseAbi(['function balanceOf(address account) view returns (uint256)']);

const bodySchema = z.object({
  address: z
    .string()
    .refine((value) => isAddress(value, { strict: false }))
    .transform((value): Address => getAddress(value)),
});

export async function POST(request: Request) {
  const sponsor = getSponsor();
  if (!sponsor) return json({ error: 'not_configured' }, 501);

  const limit = rateLimit(request, 'faucet', FAUCET_LIMIT_PER_MINUTE);
  if (!limit.ok) {
    return json({ error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds }, 429, {
      'Retry-After': String(limit.retryAfterSeconds),
    });
  }

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'bad_request' }, 400);
  const to = parsed.data.address;

  const { publicClient } = sponsor;
  let balance: bigint, maxToOwn: bigint, last: bigint, frequency: bigint, drip: bigint;
  try {
    [balance, maxToOwn, last, frequency, drip] = await Promise.all([
      publicClient.readContract({ address: TOKEN_ADDRESS, abi: tokenAbi, functionName: 'balanceOf', args: [to] }),
      publicClient.readContract({ address: FAUCET_ADDRESS, abi: faucetAbi, functionName: 'maxAmountToOwn' }),
      publicClient.readContract({ address: FAUCET_ADDRESS, abi: faucetAbi, functionName: 'lastDripTimestamp' }),
      publicClient.readContract({ address: FAUCET_ADDRESS, abi: faucetAbi, functionName: 'maxDripFrequency' }),
      publicClient.readContract({ address: FAUCET_ADDRESS, abi: faucetAbi, functionName: 'faucetDripAmount' }),
    ]);
  } catch {
    return json({ error: 'upstream_failed' }, 502);
  }

  if (balance >= maxToOwn) return json({ error: 'already_funded' }, 422);

  const now = BigInt(Math.floor(Date.now() / 1000));
  if (now < last + frequency) {
    const retryAfterSeconds = Number(last + frequency - now);
    return json({ error: 'cooldown', retryAfterSeconds }, 429, {
      'Retry-After': String(retryAfterSeconds),
    });
  }

  let simulated;
  try {
    simulated = await publicClient.simulateContract({
      account: sponsor.account,
      address: FAUCET_ADDRESS,
      abi: faucetAbi,
      functionName: 'requestFunds',
      args: [to],
    });
  } catch {
    return json({ error: 'rejected' }, 422);
  }

  try {
    if (await sponsorIsLow(sponsor)) return json({ error: 'sponsor_low' }, 503);
    const hash = await sendSerially(() => sponsor.walletClient.writeContract(simulated.request));
    return json({ hash, amountMinor: drip.toString() });
  } catch {
    return json({ error: 'send_failed' }, 502);
  }
}

export function OPTIONS() {
  return preflight();
}
