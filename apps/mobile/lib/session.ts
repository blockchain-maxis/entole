import Constants from 'expo-constants';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';

import { isMeraError, type PasskeyCredentialMetadata } from '@category-labs/mera';
import { reactNativeWebAuthnClient } from '@category-labs/mera/react-native-webauthn-client';
import { createOwnerAccount, deriveSessionAccount, signInToOwnerAccount } from '@entole/core/passkey';

import type { SignedInAccount } from './account';

/**
 * There is no phrase to write down and nothing to lose. The account is
 * derived fresh from a passkey ceremony every time — see
 * `@entole/core/passkey`. This file only remembers which passkey to ask for
 * next time (`credentialId`, not a secret) and how long the current session
 * has been open.
 *
 * Relying party: needs `entole.to/.well-known/apple-app-site-association`
 * (iOS) and `entole.to/.well-known/assetlinks.json` (Android) actually
 * hosted before a passkey ceremony will succeed on a real device — see
 * `apps/mobile/README.md`'s auth section. `EXPO_PUBLIC_RP_ID` overrides the
 * default for local/dev testing against a domain that isn't `entole.to`.
 */

const RP_ID = process.env.EXPO_PUBLIC_RP_ID ?? 'entole.to';
const RP = { id: RP_ID, name: 'Entole' };

const ONBOARDED_KEY = 'entole.onboarded';
const SESSION_KEY = 'entole.session';
const CREDENTIAL_KEY = 'entole.passkey.credential';
const DISPLAY_NAME_KEY = 'entole.display-name';

/** The name captured in `onboarding/name.tsx` — not the passkey ceremony's
 * own (unrelated) display label. Survives restarts; never key material. */
export async function storeDisplayName(name: string): Promise<void> {
  await SecureStore.setItemAsync(DISPLAY_NAME_KEY, name);
}

export async function loadDisplayName(): Promise<string> {
  return (await SecureStore.getItemAsync(DISPLAY_NAME_KEY)) ?? '';
}

export async function hasOnboarded(): Promise<boolean> {
  return (await SecureStore.getItemAsync(ONBOARDED_KEY)) === 'true';
}

export async function markOnboarded(): Promise<void> {
  await SecureStore.setItemAsync(ONBOARDED_KEY, 'true');
}

export type SignInResult = { ok: true; account: SignedInAccount } | { ok: false; reason: string };

async function storeCredential(credential: PasskeyCredentialMetadata): Promise<void> {
  await SecureStore.setItemAsync(CREDENTIAL_KEY, JSON.stringify(credential));
}

async function loadCredential(): Promise<PasskeyCredentialMetadata | undefined> {
  const raw = await SecureStore.getItemAsync(CREDENTIAL_KEY);
  if (!raw) return undefined;
  return JSON.parse(raw) as PasskeyCredentialMetadata;
}

async function checkDeviceCanAuthenticate(): Promise<string | undefined> {
  const supported = await LocalAuthentication.hasHardwareAsync();
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  if (!supported || !enrolled) {
    return 'Set up a screen lock, fingerprint or face unlock on this phone first.';
  }
  return undefined;
}

/** The underlying failure, for a development build only — the generic
 * message below tells a person nothing about *why* a passkey ceremony failed,
 * and that is exactly what someone debugging a device needs to see. */
function describeCause(cause: unknown): string {
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`;
  // The phone's passkey library rejects with a plain `{ error, message }`
  // object, not an Error — printing it as `[object Object]` hides the reason.
  if (cause && typeof cause === 'object') {
    try {
      return JSON.stringify(cause);
    } catch {
      return String(cause);
    }
  }
  return String(cause);
}

function describeError(error: unknown): string {
  if (isMeraError(error)) {
    const cause = error.cause === undefined ? '' : ` / cause: ${describeCause(error.cause)}`;
    return `${error.code}: ${error.message}${cause}`;
  }
  return describeCause(error);
}

function reasonFor(error: unknown): string {
  const inDevelopment = process.env.NODE_ENV !== 'production';
  if (inDevelopment) console.warn('[passkey]', describeError(error));

  if (isMeraError(error)) {
    if (error.code === 'PRF_UNAVAILABLE') {
      return 'This device can’t confirm it’s you the way Entole needs. Try updating it, or use another device.';
    }
  }
  return inDevelopment
    ? `We could not confirm it was you. [dev] ${describeError(error)}`
    : 'We could not confirm it was you.';
}

const assetLinksSchema = z.array(
  z.object({
    target: z.object({
      package_name: z.string().optional(),
      sha256_cert_fingerprints: z.array(z.string()).optional(),
    }),
  }),
);

/** Development builds only. "RP ID cannot be validated" doesn't say whether
 * the domain is wrong, unreachable from the phone, or lists a different app —
 * each needs a different fix — so ask the phone's own network for the linking
 * file and report what it actually saw. */
async function checkDomainAssociation(): Promise<string> {
  const packageName = Constants.expoConfig?.android?.package ?? 'to.entole.app';
  try {
    const response = await fetch(`https://${RP_ID}/.well-known/assetlinks.json`);
    if (!response.ok) return `assetlinks HTTP ${response.status}`;
    const parsed = assetLinksSchema.safeParse(await response.json());
    if (!parsed.success) return 'assetlinks reachable but not in the expected format';
    const entry = parsed.data.find((item) => item.target.package_name === packageName);
    if (!entry) return `assetlinks reachable but does not list ${packageName}`;
    return `assetlinks ok, lists ${packageName}`;
  } catch (error) {
    return `assetlinks unreachable from this phone: ${describeCause(error)}`;
  }
}

async function failed(error: unknown): Promise<{ ok: false; reason: string }> {
  const reason = reasonFor(error);
  if (process.env.NODE_ENV === 'production') return { ok: false, reason };
  const domain = await checkDomainAssociation();
  console.warn('[passkey] domain check:', RP_ID, domain);
  return { ok: false, reason: `${reason} [dev rp=${RP_ID}; ${domain}]` };
}

/**
 * Registers a new passkey and derives both the owner account and its
 * session (delegate) key from it — two ceremonies against the same passkey,
 * different PRF salts, per `@entole/core/passkey`. Called once, from
 * onboarding. Runs a real WebAuthn ceremony — on a device without
 * `entole.to`'s associated-domain files reachable, or without the target
 * platform's passkey support, this fails with a `MeraError`, not silently.
 */
export async function registerAccount(displayName: string): Promise<SignInResult> {
  const deviceProblem = await checkDeviceCanAuthenticate();
  if (deviceProblem) return { ok: false, reason: deviceProblem };

  try {
    const owner = await createOwnerAccount({
      rp: RP,
      displayName,
      webAuthnClient: reactNativeWebAuthnClient,
    });
    await storeCredential(owner.credential);
    const session = await deriveSessionAccount({
      rpId: RP_ID,
      credential: owner.credential,
      webAuthnClient: reactNativeWebAuthnClient,
    });
    await SecureStore.setItemAsync(SESSION_KEY, String(Date.now()));
    // Not known yet — captured a step later in `onboarding/name.tsx`, which
    // merges the real name into the account already in context.
    return { ok: true, account: { owner, session, displayName: '' } };
  } catch (error) {
    return failed(error);
  }
}

/**
 * Re-derives the owner account and session key from the passkey created
 * during onboarding — the sign-in / re-auth path. Never fails into an
 * unauthenticated state that looks signed in: the caller only advances on
 * `ok`.
 */
export async function reauthenticate(): Promise<SignInResult> {
  const deviceProblem = await checkDeviceCanAuthenticate();
  if (deviceProblem) return { ok: false, reason: deviceProblem };

  try {
    const credential = await loadCredential();
    const owner = await signInToOwnerAccount({
      rpId: RP_ID,
      ...(credential ? { credential } : {}),
      webAuthnClient: reactNativeWebAuthnClient,
    });
    const session = await deriveSessionAccount({
      rpId: RP_ID,
      credential: owner.credential,
      webAuthnClient: reactNativeWebAuthnClient,
    });
    await SecureStore.setItemAsync(SESSION_KEY, String(Date.now()));
    const displayName = await loadDisplayName();
    return { ok: true, account: { owner, session, displayName } };
  } catch (error) {
    return failed(error);
  }
}

const SESSION_MAX_AGE_MS = 30 * 60 * 1000;

/** Signing sessions expire. An expired one re-prompts rather than lapsing open. */
export async function sessionIsFresh(): Promise<boolean> {
  const startedAt = await SecureStore.getItemAsync(SESSION_KEY);
  if (!startedAt) return false;
  return Date.now() - Number(startedAt) < SESSION_MAX_AGE_MS;
}

export async function signOut(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY);
}

/** The hard version — clears the stored credential, name and onboarded
 * flag too, not just the session. The next launch starts at onboarding
 * from scratch, a fresh passkey ceremony, not a quick re-auth. */
export async function forgetEverything(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(SESSION_KEY),
    SecureStore.deleteItemAsync(CREDENTIAL_KEY),
    SecureStore.deleteItemAsync(ONBOARDED_KEY),
    SecureStore.deleteItemAsync(DISPLAY_NAME_KEY),
  ]);
}

/** Whether a passkey has ever been registered on this device — for the
 * Security section's "Manage passkey" status line. */
export async function hasStoredCredential(): Promise<boolean> {
  return (await SecureStore.getItemAsync(CREDENTIAL_KEY)) !== null;
}
