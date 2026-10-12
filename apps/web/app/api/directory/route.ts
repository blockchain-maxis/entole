import { getAddress, isAddress, verifyMessage, type Address } from 'viem';
import { z } from 'zod';

import {
  buildClaimMessage,
  CLAIM_MAX_AGE_SECONDS,
  phoneHandleSchema,
  usernameHandleSchema,
} from '@entole/core/directory';

import { json, preflight, readJson } from '@/lib/server/http';
import { rateLimit } from '@/lib/server/sponsor';
import {
  claimUsername,
  directoryConfigured,
  getByAddress,
  getPhoneOwner,
  getUsernameOwner,
  saveRecord,
} from '@/lib/server/directory';

/**
 * The identity directory: publishes a name, a username and, optionally, a
 * phone number for an address. Reads are open — the whole point is that
 * anyone holding a username, a number or a payment code can resolve who it is.
 * Writes require a signature proving control of the address. A username or a
 * phone number belongs to the first address that claims it, and only that
 * address can ever change or release it: that is what makes a username one
 * person's.
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
  username: usernameHandleSchema.optional(),
  timestampSeconds: z.number().int().positive(),
  signature: z
    .string()
    .regex(/^0x[0-9a-fA-F]+$/)
    .transform((value) => value as `0x${string}`),
});

/** What a lookup hands back: who it is, never when or how they registered. */
function identityOf(record: { address: Address; name: string; initials: string; tone: 1 | 2 | 3; username?: string }) {
  return {
    address: record.address,
    name: record.name,
    initials: record.initials,
    tone: record.tone,
    ...(record.username ? { username: record.username } : {}),
  };
}

export async function GET(request: Request) {
  if (!directoryConfigured()) return json({ error: 'not_configured' }, 501);

  const url = new URL(request.url);
  const rawAddress = url.searchParams.get('address');
  const country = url.searchParams.get('country');
  const number = url.searchParams.get('number');
  const username = url.searchParams.get('username');

  if (username !== null) {
    const handle = usernameHandleSchema.safeParse(username.toLowerCase());
    if (!handle.success) return json({ error: 'bad_request' }, 400);
    const owner = await getUsernameOwner(handle.data);
    if (!owner) return json({ error: 'not_found' }, 404);
    const record = await getByAddress(owner);
    if (!record) return json({ error: 'not_found' }, 404);
    return json(identityOf(record));
  }

  if (rawAddress) {
    if (!isAddress(rawAddress, { strict: false })) return json({ error: 'bad_request' }, 400);
    const record = await getByAddress(getAddress(rawAddress));
    if (!record) return json({ error: 'not_found' }, 404);
    return json(identityOf(record));
  }

  if (country && number) {
    const phone = phoneHandleSchema.safeParse({ country, number });
    if (!phone.success) return json({ error: 'bad_request' }, 400);
    const owner = await getPhoneOwner(phone.data.country, phone.data.number);
    if (!owner) return json({ error: 'not_found' }, 404);
    const record = await getByAddress(owner);
    if (!record) return json({ error: 'not_found' }, 404);
    return json(identityOf(record));
  }

  return json({ error: 'bad_request' }, 400);
}

export async function POST(request: Request) {
  if (!directoryConfigured()) return json({ error: 'not_configured' }, 501);

  const limit = await rateLimit(request, 'directory', DIRECTORY_LIMIT_PER_MINUTE);
  if (!limit.ok) {
    return json({ error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds }, 429, {
      'Retry-After': String(limit.retryAfterSeconds),
    });
  }

  const parsed = claimSchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'bad_request' }, 400);
  const { address: claimAddress, name, initials, tone, phone, username, timestampSeconds, signature } = parsed.data;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampSeconds) > CLAIM_MAX_AGE_SECONDS) return json({ error: 'stale' }, 422);

  // Signed over exactly what the caller sent — a name-only update signs
  // "phone: none" and that's what gets checked, never a phone this request
  // never mentioned.
  const message = buildClaimMessage({
    address: claimAddress,
    name,
    ...(phone ? { phone } : {}),
    ...(username ? { username } : {}),
    timestampSeconds,
  });
  const valid = await verifyMessage({ address: claimAddress, message, signature }).catch(() => false);
  if (!valid) return json({ error: 'invalid_signature' }, 401);

  if (phone) {
    const existingOwner = await getPhoneOwner(phone.country, phone.number);
    if (existingOwner && existingOwner.toLowerCase() !== claimAddress.toLowerCase()) {
      return json({ error: 'phone_taken' }, 409);
    }
  }

  // A username goes to whoever claims it first, and stays theirs. Taken in one
  // step, so two claims arriving together cannot both succeed.
  if (username && !(await claimUsername(username, claimAddress))) {
    return json({ error: 'username_taken' }, 409);
  }

  // Omitting `phone` means "this update isn't about the phone," not "remove
  // it" — an update that only changes the name must not silently drop an
  // already-claimed number. Only an explicit phone in the request ever
  // replaces what's stored.
  const existing = await getByAddress(claimAddress);
  const phoneToStore = phone ?? existing?.phone;
  // The same for a username: an update that does not name one keeps the one on file.
  const usernameToStore = username ?? existing?.username;

  await saveRecord({
    address: claimAddress,
    name,
    initials,
    tone,
    ...(phoneToStore ? { phone: phoneToStore } : {}),
    ...(usernameToStore ? { username: usernameToStore } : {}),
    updatedAt: new Date().toISOString(),
  });

  return json({ ok: true });
}

export function OPTIONS() {
  return preflight();
}
