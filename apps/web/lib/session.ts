import { isMeraError, type PasskeyCredentialMetadata } from '@category-labs/mera';
import { profileSchema, suggestUsername, type Profile } from '@entole/core/profile';
import {
  createOwnerAccount,
  deriveSessionAccount,
  signInToOwnerAccount,
  type EntoleKeyAccount,
} from '@entole/core/passkey';

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

const PROFILE_KEY = 'entole.profile';

/** The full name and username captured in `AuthGate`'s onboarding step — not
 * the passkey ceremony's own (unrelated) display label. Survives reloads;
 * never key material. */
export function storeProfile(profile: Profile): void {
  if (!storageAvailable()) return;
  window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

/** Reads the saved profile, parsed through its schema. A name saved before
 * usernames existed is carried over with a username suggested from it. */
export function loadProfile(): Profile | null {
  if (!storageAvailable()) return null;
  const raw = window.localStorage.getItem(PROFILE_KEY);
  if (raw) {
    try {
      const parsed = profileSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    } catch {
      // Fall through to the legacy name below.
    }
  }
  const legacy = window.localStorage.getItem(DISPLAY_NAME_KEY)?.trim();
  if (!legacy) return null;
  return { fullName: legacy, username: suggestUsername(legacy) || 'user' };
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
 * Registers a new passkey and derives the owner account from it — one
 * ceremony, one prompt. The assistant's key is NOT derived here: the
 * assistant is opt-in, so its key (a second ceremony, a different PRF salt,
 * per `@entole/core/passkey`) is only derived when the person approves it —
 * see `deriveAssistantAccount`. Called once, from onboarding.
 */
export async function registerAccount(displayName: string): Promise<SignInResult> {
  try {
    const owner = await createOwnerAccount({ rp: RP, displayName });
    storeCredential(owner.credential);
    window.localStorage.setItem(SESSION_KEY, String(Date.now()));
    // Not known yet — captured a step later in `AuthGate`'s onboarding flow,
    // which merges the real name into the account already in context.
    return { ok: true, account: { owner, session: null, displayName: '', username: '' } };
  } catch (error) {
    return { ok: false, reason: reasonFor(error) };
  }
}

/**
 * Re-derives the owner account from the passkey created during onboarding —
 * the sign-in / re-auth path, one prompt. The assistant's key comes back only
 * if the person has turned the assistant on, and then lazily.
 */
export async function reauthenticate(): Promise<SignInResult> {
  try {
    const credential = loadCredential();
    const owner = await signInToOwnerAccount({ rpId: RP_ID, ...(credential ? { credential } : {}) });
    window.localStorage.setItem(SESSION_KEY, String(Date.now()));
    const profile = loadProfile();
    return {
      ok: true,
      account: { owner, session: null, displayName: profile?.fullName ?? '', username: profile?.username ?? '' },
    };
  } catch (error) {
    return { ok: false, reason: reasonFor(error) };
  }
}

const ASSISTANT_ENABLED_KEY = 'entole.assistant-enabled';
const ASSISTANT_ADDRESS_KEY = 'entole.assistant-address';

/** Whether the person has approved the assistant. Off until they do. A yes/no
 * flag only — never a key. */
export function isAssistantEnabled(): boolean {
  if (!storageAvailable()) return false;
  return window.localStorage.getItem(ASSISTANT_ENABLED_KEY) === 'true';
}

/** The assistant key's *address*, saved when it was approved so that creating
 * an allowance needs no passkey prompt. Not a secret and never shown. */
export function loadAssistantAddress(): `0x${string}` | null {
  if (!storageAvailable()) return null;
  const stored = window.localStorage.getItem(ASSISTANT_ADDRESS_KEY);
  return stored ? (stored as `0x${string}`) : null;
}

export function markAssistantEnabled(address: string): void {
  if (!storageAvailable()) return;
  window.localStorage.setItem(ASSISTANT_ADDRESS_KEY, address);
  window.localStorage.setItem(ASSISTANT_ENABLED_KEY, 'true');
}

export function clearAssistant(): void {
  if (!storageAvailable()) return;
  window.localStorage.removeItem(ASSISTANT_ENABLED_KEY);
  window.localStorage.removeItem(ASSISTANT_ADDRESS_KEY);
}

/**
 * Derives the assistant's key from the same passkey with its own PRF salt —
 * a second passkey prompt. This is the ONLY place that ceremony runs: at
 * approval time, and later when the assistant first needs to act after a
 * reload. Sign-in never calls it.
 */
export async function deriveAssistantAccount(
  owner: EntoleKeyAccount,
): Promise<{ ok: true; session: EntoleKeyAccount } | { ok: false; reason: string }> {
  try {
    const session = await deriveSessionAccount({ rpId: RP_ID, credential: owner.credential });
    return { ok: true, session };
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
const PAUSE_INTRO_KEY = 'entole.pause-intro-seen';

/** Whether the one-time "what the assistant chip does" card on Home has been
 * dismissed. A yes/no flag only. */
export function hasSeenPauseIntro(): boolean {
  if (!storageAvailable()) return true;
  return window.localStorage.getItem(PAUSE_INTRO_KEY) === 'true';
}

export function markPauseIntroSeen(): void {
  if (!storageAvailable()) return;
  window.localStorage.setItem(PAUSE_INTRO_KEY, 'true');
}

export function forgetEverything(): void {
  if (!storageAvailable()) return;
  window.localStorage.removeItem(SESSION_KEY);
  window.localStorage.removeItem(CREDENTIAL_KEY);
  window.localStorage.removeItem(ONBOARDED_KEY);
  window.localStorage.removeItem(DISPLAY_NAME_KEY);
  window.localStorage.removeItem(PROFILE_KEY);
  window.localStorage.removeItem(PAUSE_INTRO_KEY);
  window.localStorage.removeItem(ASSISTANT_ENABLED_KEY);
  window.localStorage.removeItem(ASSISTANT_ADDRESS_KEY);
}

/** Whether a passkey has ever been registered in this browser — for the
 * Security section's "Manage passkey" status line. */
export function hasStoredCredential(): boolean {
  if (!storageAvailable()) return false;
  return window.localStorage.getItem(CREDENTIAL_KEY) !== null;
}
