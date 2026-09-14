import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

/**
 * There is no phrase to write down and nothing to lose. Signing in is a
 * biometric check against a key held by the device's secure hardware.
 */

const ONBOARDED_KEY = 'entole.onboarded';
const SESSION_KEY = 'entole.session';

export async function hasOnboarded(): Promise<boolean> {
  return (await SecureStore.getItemAsync(ONBOARDED_KEY)) === 'true';
}

export async function markOnboarded(): Promise<void> {
  await SecureStore.setItemAsync(ONBOARDED_KEY, 'true');
}

export type SignInResult = { ok: true } | { ok: false; reason: string };

/**
 * Never fail into an unauthenticated state that looks signed in — the caller
 * only advances on `ok`.
 */
export async function signIn(): Promise<SignInResult> {
  const supported = await LocalAuthentication.hasHardwareAsync();
  const enrolled = await LocalAuthentication.isEnrolledAsync();

  if (!supported || !enrolled) {
    return { ok: false, reason: 'Set up Face ID or a fingerprint on this phone first.' };
  }

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Confirm it is you',
    cancelLabel: 'Not now',
    disableDeviceFallback: false,
  });

  if (!result.success) return { ok: false, reason: 'We could not confirm it was you.' };

  await SecureStore.setItemAsync(SESSION_KEY, String(Date.now()));
  return { ok: true };
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
