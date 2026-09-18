import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

import { isMeraError, type PasskeyCredentialMetadata } from '@category-labs/mera';
import { reactNativeWebAuthnClient } from '@category-labs/mera/react-native-webauthn-client';
import { createOwnerAccount, signInToOwnerAccount, type EntoleKeyAccount } from '@entole/core/passkey';

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

export async function hasOnboarded(): Promise<boolean> {
  return (await SecureStore.getItemAsync(ONBOARDED_KEY)) === 'true';
}

export async function markOnboarded(): Promise<void> {
  await SecureStore.setItemAsync(ONBOARDED_KEY, 'true');
}

export type SignInResult = { ok: true; account: EntoleKeyAccount } | { ok: false; reason: string };

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
    return 'Set up Face ID or a fingerprint on this phone first.';
  }
  return undefined;
}

function reasonFor(error: unknown): string {
  if (isMeraError(error)) {
    if (error.code === 'PRF_UNAVAILABLE') {
      return 'This device can’t confirm it’s you the way Entole needs. Try updating it, or use another device.';
    }
  }
  return 'We could not confirm it was you.';
}

/**
 * Registers a new passkey and derives the owner account from it. Called
 * once, from onboarding. Runs a real WebAuthn ceremony — on a device without
 * `entole.to`'s associated-domain files reachable, or without the target
 * platform's passkey support, this fails with a `MeraError`, not silently.
 */
export async function registerAccount(displayName: string): Promise<SignInResult> {
  const deviceProblem = await checkDeviceCanAuthenticate();
  if (deviceProblem) return { ok: false, reason: deviceProblem };

  try {
    const account = await createOwnerAccount({
      rp: RP,
      displayName,
      webAuthnClient: reactNativeWebAuthnClient,
    });
    await storeCredential(account.credential);
    await SecureStore.setItemAsync(SESSION_KEY, String(Date.now()));
    return { ok: true, account };
  } catch (error) {
    return { ok: false, reason: reasonFor(error) };
  }
}

/**
 * Re-derives the owner account from the passkey created during onboarding —
 * the sign-in / re-auth path. Never fails into an unauthenticated state
 * that looks signed in: the caller only advances on `ok`.
 */
export async function reauthenticate(): Promise<SignInResult> {
  const deviceProblem = await checkDeviceCanAuthenticate();
  if (deviceProblem) return { ok: false, reason: deviceProblem };

  try {
    const credential = await loadCredential();
    const account = await signInToOwnerAccount({
      rpId: RP_ID,
      ...(credential ? { credential } : {}),
      webAuthnClient: reactNativeWebAuthnClient,
    });
    await SecureStore.setItemAsync(SESSION_KEY, String(Date.now()));
    return { ok: true, account };
  } catch (error) {
    return { ok: false, reason: reasonFor(error) };
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
