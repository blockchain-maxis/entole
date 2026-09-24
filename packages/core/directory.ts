import type { Address } from 'viem';
import { z } from 'zod';

/**
 * The opt-in identity directory client — the server side lives in
 * `apps/web/app/api/directory` (`apps/web/lib/server/directory.ts` owns the
 * storage). A person's payment code always works with no directory entry at
 * all; this only ever adds a name and, optionally, a phone-number payment
 * link on top of it. Never the address itself back out to a screen.
 */

// Matches `avatarToneSchema` in `schemas.ts` — kept separate since this
// package has no dependency the other way, but the range must agree.
const toneSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export const phoneHandleSchema = z.object({
  /** ISO 3166-1 alpha-2, lowercase — `ng` for Nigeria. */
  country: z.string().length(2),
  /** Digits only, no leading zero or country code — as `groupNumber` collects it. */
  number: z.string().regex(/^\d{6,14}$/),
});

export type PhoneHandle = z.infer<typeof phoneHandleSchema>;

const identityResultSchema = z.object({
  address: z.string(),
  name: z.string().min(1),
  initials: z.string().min(1).max(2),
  tone: toneSchema,
});

export type DirectoryIdentity = z.infer<typeof identityResultSchema>;

/**
 * The exact text a claim is signed over. Built the same way on the client
 * (before signing) and the server (before verifying) — the server never
 * trusts a client-supplied message string, only one it reconstructs itself
 * from the claim's own fields.
 */
export function buildClaimMessage(input: {
  address: Address;
  name: string;
  phone?: PhoneHandle;
  timestampSeconds: number;
}): string {
  return [
    'Entole identity claim',
    `address: ${input.address.toLowerCase()}`,
    `name: ${input.name.trim()}`,
    `phone: ${input.phone ? `${input.phone.country}:${input.phone.number}` : 'none'}`,
    `timestamp: ${input.timestampSeconds}`,
  ].join('\n');
}

/** A claim signature older than this is refused — not a replay window, a staleness one. */
export const CLAIM_MAX_AGE_SECONDS = 300;

export type DirectoryClaim = {
  address: Address;
  name: string;
  initials: string;
  tone: 1 | 2 | 3;
  phone?: PhoneHandle;
};

const CODES: Record<string, string> = {
  not_configured: "This isn't available yet.",
  bad_request: 'Something was wrong with that request. Try again.',
  stale: 'That took too long. Try again.',
  invalid_signature: "We couldn't confirm that it was you. Try again.",
  phone_taken: 'That number is already linked to a different account.',
  rate_limited: 'Too many tries. Wait a moment and try again.',
};

export class DirectoryError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(CODES[code] ?? 'Something went wrong. Try again.');
    this.name = 'DirectoryError';
    this.code = code;
  }
}

export type DirectoryClient = ReturnType<typeof createDirectoryClient>;

export function createDirectoryClient(options: {
  baseUrl: string;
  fetch?: typeof fetch;
  sign: (message: string) => Promise<`0x${string}`>;
}) {
  const fetchImpl = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/$/, '');

  async function get(query: string): Promise<DirectoryIdentity | null> {
    let response: Response;
    try {
      response = await fetchImpl(`${base}/api/directory?${query}`);
    } catch {
      return null;
    }
    if (response.status === 404) return null;
    if (!response.ok) return null;
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return null;
    }
    const parsed = identityResultSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  }

  return {
    /** `null` when that address has no directory entry — always a valid, quiet state. */
    resolveByAddress: (address: Address) => get(`address=${encodeURIComponent(address)}`),
    /** `null` when that number hasn't linked an Entole account. */
    resolveByPhone: (phone: PhoneHandle) =>
      get(`country=${encodeURIComponent(phone.country)}&number=${encodeURIComponent(phone.number)}`),

    /** Publishes (or updates) this account's own directory entry. */
    async claim(input: DirectoryClaim): Promise<void> {
      const timestampSeconds = Math.floor(Date.now() / 1000);
      const message = buildClaimMessage({
        address: input.address,
        name: input.name,
        ...(input.phone ? { phone: input.phone } : {}),
        timestampSeconds,
      });
      const signature = await options.sign(message);

      let response: Response;
      try {
        response = await fetchImpl(`${base}/api/directory`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            address: input.address,
            name: input.name,
            initials: input.initials,
            tone: input.tone,
            ...(input.phone ? { phone: input.phone } : {}),
            timestampSeconds,
            signature,
          }),
        });
      } catch {
        throw new DirectoryError('unreachable');
      }
      if (response.ok) return;
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        throw new DirectoryError('unreachable');
      }
      const errorSchema = z.object({ error: z.string() });
      const parsed = errorSchema.safeParse(json);
      throw new DirectoryError(parsed.success ? parsed.data.error : 'unreachable');
    },
  };
}
