import { getAddress, isAddress, verifyMessage, type Address } from 'viem';
import { z } from 'zod';

import {
  buildRecordsMessage,
  RECORD_CIPHERTEXT_MAX,
  RECORD_COLLECTIONS,
  RECORDS_MAX_AGE_SECONDS,
  sealedDigest,
} from '@entole/core/record-sync';

import { json, preflight, readJson } from '@/lib/server/http';
import { readCollections, recordsConfigured, writeCollection } from '@/lib/server/records';
import { rateLimit } from '@/lib/server/sponsor';

/**
 * An account's records, sealed, carried between its devices.
 *
 *   get  everything kept for this account, for a device that has none of it.
 *   put  one collection, newer than the copy kept.
 *
 * Both carry a signature from the account's owner key over what is asked, and
 * a put's signature covers the sha256 of exactly what is stored. What is kept
 * cannot be read here: it is sealed on the device with a key the server never
 * sees (`packages/core/record-sync.ts`).
 */
export const runtime = 'nodejs';

const RECORDS_LIMIT_PER_MINUTE = 60;

const address = z
  .string()
  .refine((value) => isAddress(value, { strict: false }))
  .transform((value): Address => getAddress(value));

const signature = z
  .string()
  .regex(/^0x[0-9a-fA-F]+$/)
  .transform((value) => value as `0x${string}`);

const requestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('get'),
    account: address,
    timestampSeconds: z.number().int().positive(),
    signature,
  }),
  z.object({
    action: z.literal('put'),
    account: address,
    collection: z.enum(RECORD_COLLECTIONS),
    at: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    ciphertext: z.string().regex(/^0x[0-9a-f]+$/).max(RECORD_CIPHERTEXT_MAX),
    timestampSeconds: z.number().int().positive(),
    signature,
  }),
]);

export async function POST(request: Request) {
  if (!recordsConfigured()) return json({ error: 'not_configured' }, 501);

  const limit = await rateLimit(request, 'records', RECORDS_LIMIT_PER_MINUTE);
  if (!limit.ok) {
    return json({ error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds }, 429, {
      'Retry-After': String(limit.retryAfterSeconds),
    });
  }

  const parsed = requestSchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'bad_request' }, 400);
  const body = parsed.data;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - body.timestampSeconds) > RECORDS_MAX_AGE_SECONDS) return json({ error: 'stale' }, 422);
  // A record dated far ahead would never be replaced by a real write after it.
  if (body.action === 'put' && body.at > Date.now() + RECORDS_MAX_AGE_SECONDS * 1000) {
    return json({ error: 'bad_request' }, 400);
  }

  const message =
    body.action === 'get'
      ? buildRecordsMessage({ account: body.account, action: 'get', timestampSeconds: body.timestampSeconds })
      : buildRecordsMessage({
          account: body.account,
          action: 'put',
          collection: body.collection,
          at: body.at,
          digest: sealedDigest(body.ciphertext),
          timestampSeconds: body.timestampSeconds,
        });
  const valid = await verifyMessage({ address: body.account, message, signature: body.signature }).catch(() => false);
  if (!valid) return json({ error: 'invalid_signature' }, 401);

  if (body.action === 'get') return json({ collections: await readCollections(body.account) });

  const outcome = await writeCollection(body.account, body.collection, { at: body.at, ciphertext: body.ciphertext });
  return outcome === 'kept' ? json({ ok: true }) : json({ error: 'older' }, 409);
}

export function OPTIONS() {
  return preflight();
}
