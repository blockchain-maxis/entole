import { getRandomValues } from 'expo-crypto';

/**
 * React Native has no `globalThis.crypto.getRandomValues`, but Mera's passkey
 * calls (`createPasskeyWithPrfOutput` / `getPasskeyPrfOutput`) read it for the
 * challenge they send the authenticator, and throw `CRYPTO_UNAVAILABLE` without
 * it. `expo-crypto` is the platform's real secure random source — never
 * `Math.random`, which would make those values guessable.
 *
 * Only fills the gap; a runtime that already provides it is left alone.
 */
const scope = globalThis as unknown as { crypto?: { getRandomValues?: unknown } };

if (!scope.crypto) scope.crypto = {};
if (typeof scope.crypto.getRandomValues !== 'function') {
  scope.crypto.getRandomValues = getRandomValues;
}
