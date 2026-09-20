import { keccak256, toHex } from 'viem';
import { z } from 'zod';

/**
 * Who a person is inside Entole, as other people and their own screens see
 * them: a full name, a username, and a short code. None of it is an address —
 * the code below is a one-way hash, never the address or any slice of it.
 */

export const FULL_NAME_MIN = 2;
export const FULL_NAME_MAX = 60;
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

const USERNAME_PATTERN = /^[a-z0-9_.]+$/;

/**
 * Validates *format only*. Two people can pick the same username: nothing here
 * can check uniqueness, because there is no backend to ask. The unique handle
 * for a person is their code (`entoleCode`), which is derived from their
 * account and so cannot collide in practice.
 */
export const profileSchema = z.object({
  fullName: z.string().trim().min(FULL_NAME_MIN).max(FULL_NAME_MAX),
  username: z.string().min(USERNAME_MIN).max(USERNAME_MAX).regex(USERNAME_PATTERN),
});

export type Profile = z.infer<typeof profileSchema>;

/** Lower-cases and strips a leading "@" and any spaces, so what a person types
 * ("@Ada Eze") is close to what will be stored ("adaeze"). */
export function normalizeUsername(input: string): string {
  return input.trim().replace(/^@+/, '').replace(/\s+/g, '').toLowerCase();
}

/** A message for the first thing wrong with a full name, or null when fine. */
export function validateFullName(input: string): string | null {
  const name = input.trim();
  if (name.length < FULL_NAME_MIN) return 'Enter your full name.';
  if (name.length > FULL_NAME_MAX) return `Keep your name under ${FULL_NAME_MAX + 1} characters.`;
  return null;
}

/** A message for the first thing wrong with a username, or null when fine. */
export function validateUsername(input: string): string | null {
  const username = normalizeUsername(input);
  if (username.length < USERNAME_MIN) return `Use at least ${USERNAME_MIN} characters.`;
  if (username.length > USERNAME_MAX) return `Use at most ${USERNAME_MAX} characters.`;
  if (!USERNAME_PATTERN.test(username)) return 'Use only lowercase letters, numbers, dots and underscores.';
  return null;
}

/** "Ada Eze" -> "ada.eze". Empty when nothing usable can be made of the name. */
export function suggestUsername(fullName: string): string {
  const base = fullName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, USERNAME_MAX)
    .replace(/\.+$/g, '');
  return base.length >= USERNAME_MIN ? base : '';
}

/** First + last initial, uppercased. "?" for an empty name. */
export function initialsFor(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : '';
  return (first + last).toUpperCase();
}

// Crockford base32: no I, L, O or U, so a code read aloud or copied by hand is
// not misread.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A short, human-friendly, deterministic code for an account, e.g.
 * `ENT-7K3Q-92XA`. It is 40 bits of a domain-separated keccak hash of the
 * address, so it identifies the account without ever revealing the address (or
 * any part of it) — screens show this instead of an address.
 */
export function entoleCode(address: string): string {
  const digest = keccak256(toHex(`entole.code.v1:${address.trim().toLowerCase()}`));
  const bits = BigInt(`0x${digest.slice(2, 12)}`); // first 5 bytes = 40 bits = 8 characters
  let code = '';
  for (let i = 0; i < 8; i += 1) {
    code += CROCKFORD[Number((bits >> BigInt(35 - 5 * i)) & 31n)];
  }
  return `ENT-${code.slice(0, 4)}-${code.slice(4)}`;
}
