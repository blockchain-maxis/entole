import Constants from 'expo-constants';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { z } from 'zod';

import { isMeraError, type PasskeyCredentialMetadata } from '@category-labs/mera';
import { reactNativeWebAuthnClient } from '@category-labs/mera/react-native-webauthn-client';
import {
  createOwnerAccount,
  deriveSessionAccount,
  signInToOwnerAccount,
  type EntoleKeyAccount,
} from '@entole/core/passkey';
import { FULL_NAME_MIN, profileSchema, suggestUsername, type Profile } from '@entole/core/profile';

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

const PROFILE_KEY = 'entole.profile';

/** Full name and username, captured in `onboarding/name.tsx` and editable in
 * Me — not the passkey ceremony's own (unrelated) display label. One JSON
 * value; survives restarts; never key material. */
export async function storeProfile(profile: Profile): Promise<void> {
  await SecureStore.setItemAsync(PROFILE_KEY, JSON.stringify(profile));
}

/** The saved profile, or null when none exists yet. A device that only ever
 * saved the old single display name gets that name as the full name, with a
 * username suggested from it, so nobody is sent back through onboarding. */
export async function loadProfile(): Promise<Profile | null> {
  const raw = await SecureStore.getItemAsync(PROFILE_KEY);
  if (raw) {
    try {
      const parsed = profileSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    } catch {
      // Unreadable value: fall through to the legacy name, if any.
    }
  }

  const legacy = (await SecureStore.getItemAsync(DISPLAY_NAME_KEY))?.trim();
  if (legacy && legacy.length >= FULL_NAME_MIN) {
    return { fullName: legacy, username: suggestUsername(legacy) || 'user' };
  }
  return null;
}

const PAUSE_INTRO_KEY = 'entole.pause-intro-seen';

/** Whether the one-time "what the assistant chip does" card on Home has been
 * dismissed. A yes/no flag only. */
export async function hasSeenPauseIntro(): Promise<boolean> {
  return (await SecureStore.getItemAsync(PAUSE_INTRO_KEY)) === 'true';
}

export async function markPauseIntroSeen(): Promise<void> {
  await SecureStore.setItemAsync(PAUSE_INTRO_KEY, 'true');
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

const googleStatementsSchema = z.object({
  statements: z
    .array(z.object({ target: z.object({ androidApp: z.object({ packageName: z.string() }).optional() }) }))
    .optional(),
});

/** Development builds only. The passkey check is made by Google Play services
 * using Google's own Digital Asset Links service, not by reading the site
 * directly — so a phone that can reach the site but not Google (VPN, private
 * DNS, an ad blocker) fails here with the same "RP ID cannot be validated". */
async function checkGoogleView(): Promise<string> {
  const packageName = Constants.expoConfig?.android?.package ?? 'to.entole.app';
  const url =
    'https://digitalassetlinks.googleapis.com/v1/statements:list' +
    `?source.web.site=https://${RP_ID}&relation=delegate_permission/common.get_login_creds`;
  try {
    const response = await fetch(url);
    if (!response.ok) return `google checker HTTP ${response.status}`;
    const parsed = googleStatementsSchema.safeParse(await response.json());
    if (!parsed.success) return 'google checker reachable but answered in an unexpected format';
    const listed = (parsed.data.statements ?? []).some((s) => s.target.androidApp?.packageName === packageName);
    return listed ? `google checker sees ${packageName}` : `google checker does NOT list ${packageName}`;
  } catch (error) {
    return `google checker unreachable from this phone: ${describeCause(error)}`;
  }
}

/** Development builds only — which phone and Android version this is, since
 * passkey support and the provider that answers vary by both. */
function describeDevice(): string {
  if (Platform.OS !== 'android') return Platform.OS;
  const { Manufacturer, Brand, Model, Release } = Platform.constants;
  return `Android ${Release} (API ${Platform.Version}), ${Manufacturer ?? Brand} ${Model}`;
}

async function failed(error: unknown): Promise<{ ok: false; reason: string }> {
  const reason = reasonFor(error);
  if (process.env.NODE_ENV === 'production') return { ok: false, reason };
  const [domain, google] = await Promise.all([checkDomainAssociation(), checkGoogleView()]);
  const device = describeDevice();
  console.warn('[passkey] domain check:', RP_ID, domain, '|', google, '|', device);
  return { ok: false, reason: `${reason} [dev rp=${RP_ID}; ${domain}; ${google}; ${device}]` };
}

/**
 * Registers a new passkey and derives the owner account from it — one
 * ceremony, one prompt. The assistant's key is NOT derived here: the
 * assistant is opt-in, so its key (a second ceremony, a different PRF salt,
 * per `@entole/core/passkey`) is only derived when the person approves it —
 * see `deriveAssistantAccount`. Called once, from onboarding. Runs a real
 * WebAuthn ceremony — on a device without `entole.to`'s associated-domain
 * files reachable, or without the target platform's passkey support, this
 * fails with a `MeraError`, not silently.
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
    await SecureStore.setItemAsync(SESSION_KEY, String(Date.now()));
    // Not known yet — captured a step later in `onboarding/name.tsx`, which
    // merges the real name into the account already in context.
    return { ok: true, account: { owner, session: null, displayName: '', username: '' } };
  } catch (error) {
    return failed(error);
  }
}

/**
 * Re-derives the owner account from the passkey created during onboarding —
 * the sign-in / re-auth path, one prompt. The assistant's key comes back only
 * if the person has turned the assistant on, and then lazily (see
 * `useAssistant`). Never fails into an unauthenticated state that looks
 * signed in: the caller only advances on `ok`.
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
    await SecureStore.setItemAsync(SESSION_KEY, String(Date.now()));
    const profile = await loadProfile();
    return {
      ok: true,
      account: {
        owner,
        session: null,
        displayName: profile?.fullName ?? '',
        username: profile?.username ?? '',
      },
    };
  } catch (error) {
    return failed(error);
  }
}

const ASSISTANT_ENABLED_KEY = 'entole.assistant-enabled';
const ASSISTANT_ADDRESS_KEY = 'entole.assistant-address';

/** Whether the person has approved the assistant. Off until they do. A yes/no
 * flag only — never a key. */
export async function isAssistantEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(ASSISTANT_ENABLED_KEY)) === 'true';
}

/** The assistant key's *address*, saved when it was approved so that creating
 * an allowance needs no passkey prompt. Not a secret and never shown. */
export async function loadAssistantAddress(): Promise<`0x${string}` | null> {
  const stored = await SecureStore.getItemAsync(ASSISTANT_ADDRESS_KEY);
  return stored ? (stored as `0x${string}`) : null;
}

export async function markAssistantEnabled(address: string): Promise<void> {
  await SecureStore.setItemAsync(ASSISTANT_ADDRESS_KEY, address);
  await SecureStore.setItemAsync(ASSISTANT_ENABLED_KEY, 'true');
}

export async function clearAssistant(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ASSISTANT_ENABLED_KEY),
    SecureStore.deleteItemAsync(ASSISTANT_ADDRESS_KEY),
  ]);
}

/**
 * Derives the assistant's key from the same passkey with its own PRF salt —
 * a second passkey prompt. This is the ONLY place that ceremony runs: at
 * approval time, and later when the assistant first needs to act after a
 * restart. Sign-in never calls it.
 */
export async function deriveAssistantAccount(
  owner: EntoleKeyAccount,
): Promise<{ ok: true; session: EntoleKeyAccount } | { ok: false; reason: string }> {
  try {
    const session = await deriveSessionAccount({
      rpId: RP_ID,
      credential: owner.credential,
      webAuthnClient: reactNativeWebAuthnClient,
    });
    return { ok: true, session };
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
    SecureStore.deleteItemAsync(PROFILE_KEY),
    SecureStore.deleteItemAsync(PAUSE_INTRO_KEY),
    SecureStore.deleteItemAsync(ASSISTANT_ENABLED_KEY),
    SecureStore.deleteItemAsync(ASSISTANT_ADDRESS_KEY),
  ]);
}

/** Whether a passkey has ever been registered on this device — for the
 * Security section's "Manage passkey" status line. */
export async function hasStoredCredential(): Promise<boolean> {
  return (await SecureStore.getItemAsync(CREDENTIAL_KEY)) !== null;
}
