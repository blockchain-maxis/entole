import { getAddress, isAddress, verifyMessage, type Address } from 'viem';
import { z } from 'zod';

import { buildClaimMessage, CLAIM_MAX_AGE_SECONDS, phoneHandleSchema } from '@entole/core/directory';

import { json, preflight, readJson } from '@/lib/server/http';
import { rateLimit } from '@/lib/server/sponsor';
import { directoryConfigured, getByAddress, getPhoneOwner, saveRecord } from '@/lib/server/directory';

/**
 * The opt-in identity directory: publishes a name (and, optionally, a
 * phone-number payment link) for an address someone chooses to make
 * discoverable. Reads are open — the whole point is that anyone holding a
 * payment code or a phone-number link can resolve a name from it. Writes
 * require a signature proving control of the address; a phone number, once
 * claimed, can only ever be updated by the same address that claimed it.
 */
export const runtime = 'nodejs';

const DIRECTORY_LIMIT_PER_MINUTE = 20;

const address = z
  .string()
  .refine((value) => isAddress(value, { strict: false }))
  .transform((value): Address => getAddress(value));

const claimSchema = z.object({
  address,
  name: z.string().trim().min(1).max(60),
  initials: z.string().trim().min(1).max(2),
  tone: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  phone: phoneHandleSchema.optional(),
  timestampSeconds: z.number().int().positive(),
  signature: z
    .string()
    .regex(/^0x[0-9a-fA-F]+$/)
    .transform((value) => value as `0x${string}`),
});

export async function GET(request: Request) {
  if (!directoryConfigured()) return json({ error: 'not_configured' }, 501);

  const url = new URL(request.url);
  const rawAddress = url.searchParams.get('address');
  const country = url.searchParams.get('country');
  const number = url.searchParams.get('number');

  if (rawAddress) {
    if (!isAddress(rawAddress, { strict: false })) return json({ error: 'bad_request' }, 400);
    const record = await getByAddress(getAddress(rawAddress));
    if (!record) return json({ error: 'not_found' }, 404);
    return json({ address: record.address, name: record.name, initials: record.initials, tone: record.tone });
  }

  if (country && number) {
    const phone = phoneHandleSchema.safeParse({ country, number });
    if (!phone.success) return json({ error: 'bad_request' }, 400);
    const owner = await getPhoneOwner(phone.data.country, phone.data.number);
    if (!owner) return json({ error: 'not_found' }, 404);
    const record = await getByAddress(owner);
    if (!record) return json({ error: 'not_found' }, 404);
    return json({ address: record.address, name: record.name, initials: record.initials, tone: record.tone });
  }

  return json({ error: 'bad_request' }, 400);
}

export async function POST(request: Request) {
  if (!directoryConfigured()) return json({ error: 'not_configured' }, 501);

  const limit = rateLimit(request, 'directory', DIRECTORY_LIMIT_PER_MINUTE);
  if (!limit.ok) {
    return json({ error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds }, 429, {
      'Retry-After': String(limit.retryAfterSeconds),
    });
  }

  const parsed = claimSchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'bad_request' }, 400);
  const { address: claimAddress, name, initials, tone, phone, timestampSeconds, signature } = parsed.data;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampSeconds) > CLAIM_MAX_AGE_SECONDS) return json({ error: 'stale' }, 422);

  // Signed over exactly what the caller sent — a name-only update signs
  // "phone: none" and that's what gets checked, never a phone this request
  // never mentioned.
  const message = buildClaimMessage({ address: claimAddress, name, ...(phone ? { phone } : {}), timestampSeconds });
  const valid = await verifyMessage({ address: claimAddress, message, signature }).catch(() => false);
  if (!valid) return json({ error: 'invalid_signature' }, 401);

  if (phone) {
    const existingOwner = await getPhoneOwner(phone.country, phone.number);
    if (existingOwner && existingOwner.toLowerCase() !== claimAddress.toLowerCase()) {
      return json({ error: 'phone_taken' }, 409);
    }
  }

  // Omitting `phone` means "this update isn't about the phone," not "remove
  // it" — an update that only changes the name must not silently drop an
  // already-claimed number. Only an explicit phone in the request ever
  // replaces what's stored.
  const existing = await getByAddress(claimAddress);
  const phoneToStore = phone ?? existing?.phone;

  await saveRecord({
    address: claimAddress,
    name,
    initials,
    tone,
    ...(phoneToStore ? { phone: phoneToStore } : {}),
    updatedAt: new Date().toISOString(),
  });

  return json({ ok: true });
}

export function OPTIONS() {
  return preflight();
}
