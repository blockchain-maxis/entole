import { AURORA_SOURCE_IDS, auroraSource } from '@entole/core/aurora-intents';
import {
  generatedIntentSchema,
  prepareBringBack,
  readHeldInIntents,
  submitBringBack,
  type OneClickConfig,
} from '@entole/core/intents-held';
import { requestDepositCode } from '@entole/core/onramp';
import { verifyMessage } from 'viem';
import { z } from 'zod';

import { json, preflight, readJson } from '@/lib/server/http';
import { accountAddress, readMoneyInConfig } from '@/lib/server/onramp';
import { rateLimit } from '@/lib/server/sponsor';

/**
 * Money from Tron or Solana that Aurora could not deliver, held for the person
 * in their own NEAR Intents account (`packages/core/intents-held.ts`).
 *
 *   GET  ?address=   how much is held, for each thing that can be sent in.
 *   POST prepare     writes the intent that brings it home: from the Intents
 *                    account, as USDC on Arbitrum, into a holding address that
 *                    turns it into the account's own money on Monad.
 *   POST submit      hands over that intent, signed by the person's own key.
 *
 * The server never signs. Only the person's key can move what is held, and
 * the intent it signs names exactly one swap to exactly one holding address
 * for them. Off (501) away from the main network, and preparing or submitting
 * needs `ONECLICK_API_KEY`, 1Click's partner key.
 */
export const runtime = 'nodejs';

const LIMIT_PER_MINUTE = 10;

const postSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('prepare'), address: accountAddress, source: z.enum(AURORA_SOURCE_IDS) }),
  z.object({
    action: z.literal('submit'),
    address: accountAddress,
    intent: generatedIntentSchema,
    signature: z
      .string()
      .regex(/^0x[0-9a-fA-F]{130}$/)
      .transform((value) => value as `0x${string}`),
  }),
]);

function readOneClick(): OneClickConfig | null {
  const apiKey = process.env.ONECLICK_API_KEY?.trim();
  if (!apiKey) return null;
  const apiBase = process.env.ONECLICK_API_BASE?.trim();
  return { apiKey, ...(apiBase ? { apiBase } : {}) };
}

function limited(retryAfterSeconds: number) {
  return json({ error: 'rate_limited', retryAfterSeconds }, 429, { 'Retry-After': String(retryAfterSeconds) });
}

export async function GET(request: Request) {
  if (!readMoneyInConfig()) return json({ error: 'not_configured' }, 501);
  const address = accountAddress.safeParse(new URL(request.url).searchParams.get('address'));
  if (!address.success) return json({ error: 'bad_request' }, 400);
  const limit = await rateLimit(request, 'aurora-held', LIMIT_PER_MINUTE * 3, address.data);
  if (!limit.ok) return limited(limit.retryAfterSeconds);

  try {
    const held = await Promise.all(
      AURORA_SOURCE_IDS.map(async (source) => ({
        source,
        units: (await readHeldInIntents({ owner: address.data, tokenId: auroraSource(source)!.assetId })).toString(),
      })),
    );
    return json({ held: held.filter((entry) => entry.units !== '0'), canBringBack: readOneClick() !== null });
  } catch {
    return json({ error: 'partner_unavailable' }, 502);
  }
}

export async function POST(request: Request) {
  const moneyIn = readMoneyInConfig();
  const oneClick = readOneClick();
  if (!moneyIn || !oneClick) return json({ error: 'not_configured' }, 501);

  const parsed = postSchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'bad_request' }, 400);
  const body = parsed.data;
  const limit = await rateLimit(request, 'aurora-held', LIMIT_PER_MINUTE, body.address);
  if (!limit.ok) return limited(limit.retryAfterSeconds);

  try {
    if (body.action === 'prepare') {
      const tokenId = auroraSource(body.source)!.assetId;
      const amount = await readHeldInIntents({ owner: body.address, tokenId });
      if (amount === 0n) return json({ error: 'nothing_held' }, 404);
      // The same conversion as "USDC on Arbitrum" from another app, for this account.
      const { code: holdingAddress } = await requestDepositCode({ recipient: body.address, source: 'arbitrum-usdc' }, moneyIn);
      const prepared = await prepareBringBack({ owner: body.address, tokenId, amount, holdingAddress }, oneClick);
      return json({ intent: prepared.intent, units: amount.toString() });
    }

    // Only the account's own signature over this exact intent is handed on.
    const signed = await verifyMessage({ address: body.address, message: body.intent.payload, signature: body.signature }).catch(
      () => false,
    );
    if (!signed) return json({ error: 'invalid_signature' }, 401);
    const intentHash = await submitBringBack({ intent: body.intent, signature: body.signature }, oneClick);
    return json({ intentHash });
  } catch {
    return json({ error: 'partner_unavailable' }, 502);
  }
}

export function OPTIONS() {
  return preflight();
}
