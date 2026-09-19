import { isMeraError, type PasskeyCredentialMetadata } from '@category-labs/mera';
import { createOwnerAccount, deriveSessionAccount, signInToOwnerAccount } from '@entole/core/passkey';

import type { SignedInAccount } from './account';

/**
 * There is no phrase to write down and nothing to lose. The account is
 * derived fresh from a passkey ceremony every time — see
 * `@entole/core/passkey`. This file only remembers which passkey to ask for
 * next time (`credentialId`, not a secret) and how long the current session
 * has been open. `localStorage` never sees key material, only that id.
 *
 * No explicit `webAuthnClient` is passed to any passkey call here — Mera
 * defaults to `browserWebAuthnClient`, which calls the browser's own
 * `navigator.credentials` WebAuthn API directly. That default is the whole
 * story on web; the phone app passes an explicit React Native client only
 * because RN has no `navigator.credentials` of its own.
 *
 * Relying party: needs `entole.to/.well-known/apple-app-site-association`
 * and `entole.to/.well-known/assetlinks.json` actually hosted before a
 * passkey ceremony will succeed for the installed-PWA case on a real device
 * — see `apps/web/public/.well-known/`. `NEXT_PUBLIC_RP_ID` overrides the
 * default for local/dev testing against a domain that isn't `entole.to`.
 */

const RP_ID = process.env.NEXT_PUBLIC_RP_ID ?? 'entole.to';
const RP = { id: RP_ID, name: 'Entole' };

const ONBOARDED_KEY = 'entole.onboarded';
const SESSION_KEY = 'entole.session';
const CREDENTIAL_KEY = 'entole.passkey.credential';
const DISPLAY_NAME_KEY = 'entole.display-name';

/** The name captured in `AuthGate`'s onboarding step — not the passkey
 * ceremony's own (unrelated) display label. Survives reloads; never key
 * material. */
export function storeDisplayName(name: string): void {
  if (!storageAvailable()) return;
  window.localStorage.setItem(DISPLAY_NAME_KEY, name);
}

export function loadDisplayName(): string {
  if (!storageAvailable()) return '';
  return window.localStorage.getItem(DISPLAY_NAME_KEY) ?? '';
}

function storageAvailable(): boolean {
  return typeof window !== 'undefined' && 'localStorage' in window;
}

export function hasOnboarded(): boolean {
  if (!storageAvailable()) return false;
  return window.localStorage.getItem(ONBOARDED_KEY) === 'true';
}

export function markOnboarded(): void {
  if (!storageAvailable()) return;
  window.localStorage.setItem(ONBOARDED_KEY, 'true');
}

export type SignInResult = { ok: true; account: SignedInAccount } | { ok: false; reason: string };

function storeCredential(credential: PasskeyCredentialMetadata): void {
  if (!storageAvailable()) return;
  window.localStorage.setItem(CREDENTIAL_KEY, JSON.stringify(credential));
}

function loadCredential(): PasskeyCredentialMetadata | undefined {
  if (!storageAvailable()) return undefined;
  const raw = window.localStorage.getItem(CREDENTIAL_KEY);
  if (!raw) return undefined;
  return JSON.parse(raw) as PasskeyCredentialMetadata;
}

function reasonFor(error: unknown): string {
  if (isMeraError(error)) {
    if (error.code === 'PRF_UNAVAILABLE') {
      return 'This browser can’t confirm it’s you the way Entole needs. Try updating it, or use another device.';
    }
  }
  return 'We could not confirm it was you.';
}

/**
 * Registers a new passkey and derives both the owner account and its
 * session (delegate) key from it — two ceremonies against the same passkey,
 * different PRF salts, per `@entole/core/passkey`. Called once, from
 * onboarding.
 */
export async function registerAccount(displayName: string): Promise<SignInResult> {
  try {
    const owner = await createOwnerAccount({ rp: RP, displayName });
    storeCredential(owner.credential);
    const session = await deriveSessionAccount({ rpId: RP_ID, credential: owner.credential });
    window.localStorage.setItem(SESSION_KEY, String(Date.now()));
    // Not known yet — captured a step later in `AuthGate`'s onboarding flow,
    // which merges the real name into the account already in context.
    return { ok: true, account: { owner, session, displayName: '' } };
  } catch (error) {
    return { ok: false, reason: reasonFor(error) };
  }
}

/**
 * Re-derives the owner account and session key from the passkey created
 * during onboarding — the sign-in / re-auth path.
 */
export async function reauthenticate(): Promise<SignInResult> {
  try {
    const credential = loadCredential();
    const owner = await signInToOwnerAccount({ rpId: RP_ID, ...(credential ? { credential } : {}) });
    const session = await deriveSessionAccount({ rpId: RP_ID, credential: owner.credential });
    window.localStorage.setItem(SESSION_KEY, String(Date.now()));
    return { ok: true, account: { owner, session, displayName: loadDisplayName() } };
  } catch (error) {
    return { ok: false, reason: reasonFor(error) };
  }
}

const SESSION_MAX_AGE_MS = 30 * 60 * 1000;

/** Signing sessions expire. An expired one re-prompts rather than lapsing open. */
export function sessionIsFresh(): boolean {
  if (!storageAvailable()) return false;
  const startedAt = window.localStorage.getItem(SESSION_KEY);
  if (!startedAt) return false;
  return Date.now() - Number(startedAt) < SESSION_MAX_AGE_MS;
}

export function signOut(): void {
  if (!storageAvailable()) return;
  window.localStorage.removeItem(SESSION_KEY);
}

/** The hard version — clears the stored credential, name and onboarded
 * flag too, not just the session. The next visit starts at onboarding
 * from scratch, a fresh passkey ceremony, not a quick re-auth. */
export function forgetEverything(): void {
  if (!storageAvailable()) return;
  window.localStorage.removeItem(SESSION_KEY);
  window.localStorage.removeItem(CREDENTIAL_KEY);
  window.localStorage.removeItem(ONBOARDED_KEY);
  window.localStorage.removeItem(DISPLAY_NAME_KEY);
}

/** Whether a passkey has ever been registered in this browser — for the
 * Security section's "Manage passkey" status line. */
export function hasStoredCredential(): boolean {
  if (!storageAvailable()) return false;
  return window.localStorage.getItem(CREDENTIAL_KEY) !== null;
}
