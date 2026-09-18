import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  getPasskeyPrfOutput,
  type PasskeyCredentialMetadata,
  type PasskeyRelyingParty,
  type WebAuthnClient,
} from '@category-labs/mera';
import { toViemAccount } from '@category-labs/mera/viem';
import type { LocalAccount } from 'viem';

/**
 * The passkey-native account layer — Mera, per docs/ARCHITECTURE.md.
 *
 * No seed phrase exists anywhere in this file. A passkey ceremony returns 32
 * bytes; those bytes are the secp256k1 private key directly. The same
 * ceremony, run again with the same relying party and salt, returns the same
 * bytes — that's the whole recovery story, and the whole reason there's
 * nothing here to write down or lose.
 *
 * One passkey derives more than one key by varying the PRF salt — this is
 * the mechanism behind "Mera: one passkey, many keys." The owner key (holds
 * funds, authorises create/revoke/pause) and a session key (the assistant's
 * delegate — holds no funds, can only call `execute` inside its caveats,
 * per docs/ARCHITECTURE.md's trust boundary) come from the same passkey,
 * two different salts, two different WebAuthn ceremonies.
 */

const OWNER_SALT = sha256(utf8ToBytes('entole.account.owner.v1'));
const SESSION_SALT = sha256(utf8ToBytes('entole.account.session.v1'));

export type EntoleKeyAccount = {
  address: `0x${string}`;
  credential: PasskeyCredentialMetadata;
  /** Ends the signing session, zeroing the key in memory. Call when the
   * account is no longer needed this run — e.g. on lock or sign-out. */
  end(): void;
  /** A viem `LocalAccount` — pass this straight to `createOnChainGateway`'s
   * `ownerWalletClient`/`delegateWalletClient`. */
  viemAccount: LocalAccount<'mera'>;
};

function toEntoleAccount(
  credential: PasskeyCredentialMetadata,
  prfOutput: Uint8Array,
): EntoleKeyAccount {
  const session = createSecp256k1SigningSession({ privateKey: prfOutput });
  const viemAccount = toViemAccount(session);
  return { address: viemAccount.address, credential, end: session.end, viemAccount };
}

/**
 * Registers a new passkey and derives the owner account from it. Onboarding
 * calls this once; there is nothing else to store — the credential metadata
 * returned here is enough to sign back in later with `signInToOwnerAccount`.
 */
export async function createOwnerAccount(options: {
  rp: PasskeyRelyingParty;
  displayName: string;
  webAuthnClient?: WebAuthnClient;
}): Promise<EntoleKeyAccount> {
  const created = await createPasskeyWithPrfOutput({
    rp: options.rp,
    user: { name: options.displayName, displayName: options.displayName },
    prfSalt: OWNER_SALT,
    ...(options.webAuthnClient ? { webAuthnClient: options.webAuthnClient } : {}),
  });
  return toEntoleAccount(
    { credentialId: created.credentialId, ...(created.transports ? { transports: created.transports } : {}) },
    created.prfOutput,
  );
}

/**
 * Re-derives the owner account from an existing passkey — the sign-in path.
 * One biometric prompt, no stored key material read from disk.
 */
export async function signInToOwnerAccount(options: {
  rpId: string;
  credential?: PasskeyCredentialMetadata;
  webAuthnClient?: WebAuthnClient;
}): Promise<EntoleKeyAccount> {
  const asserted = await getPasskeyPrfOutput({
    rpId: options.rpId,
    prfSalt: OWNER_SALT,
    ...(options.credential ? { credential: options.credential } : {}),
    ...(options.webAuthnClient ? { webAuthnClient: options.webAuthnClient } : {}),
  });
  return toEntoleAccount({ credentialId: asserted.credentialId }, asserted.prfOutput);
}

/**
 * Derives the session (delegate) key from the same passkey, a different
 * salt. Called once, the first time the assistant needs a key to act with —
 * not at onboarding, so a person who never grants an allowance never sees
 * this prompt. The resulting key holds no funds and can only spend inside
 * whatever caveats the owner's own `createAllowance` call grants it.
 */
export async function deriveSessionAccount(options: {
  rpId: string;
  credential?: PasskeyCredentialMetadata;
  webAuthnClient?: WebAuthnClient;
}): Promise<EntoleKeyAccount> {
  const asserted = await getPasskeyPrfOutput({
    rpId: options.rpId,
    prfSalt: SESSION_SALT,
    ...(options.credential ? { credential: options.credential } : {}),
    ...(options.webAuthnClient ? { webAuthnClient: options.webAuthnClient } : {}),
  });
  return toEntoleAccount({ credentialId: asserted.credentialId }, asserted.prfOutput);
}
