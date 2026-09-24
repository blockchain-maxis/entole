import { phoneHandleSchema, type PhoneHandle } from './directory';

/**
 * A payment link built from a phone number instead of an opaque code —
 * `https://<app>/ng/8012345678` — for a Nigeria-first product where "pay by
 * number" is the expected pattern. Only resolves to anything if that number
 * has actually claimed a directory entry (see `packages/core/directory.ts`);
 * an unclaimed number is just a link that leads nowhere, same as a payment
 * code no one has ever generated.
 */

/** The shareable link for a phone handle. */
export function buildPhoneLink(base: string, phone: PhoneHandle): string {
  return `${base.replace(/\/$/, '')}/${phone.country}/${phone.number}`;
}

/**
 * Reads a phone-link — or a bare `<country>/<number>` fragment — into the
 * handle it names. Accepts a full URL, a path, or an `entole://<cc>/<n>` deep
 * link. `null` for anything that doesn't carry a plausible one; this never
 * touches the network, so it can't say whether the number is actually
 * claimed — that's what `DirectoryClient.resolveByPhone` is for.
 */
export function parsePhoneLink(input: string): PhoneHandle | null {
  const text = input.trim();
  if (!text) return null;

  const withoutQuery = text.split('?', 1)[0] ?? '';
  const withoutScheme = withoutQuery.replace(/^[a-z]+:\/\//i, '');
  const segments = withoutScheme.split('/').filter(Boolean);
  // The last two path segments: `<host>/ng/8012345678` or bare `ng/8012345678`.
  const number = segments.at(-1);
  const country = segments.at(-2);
  if (!country || !number) return null;

  const parsed = phoneHandleSchema.safeParse({ country: country.toLowerCase(), number });
  return parsed.success ? parsed.data : null;
}
