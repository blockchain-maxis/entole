import { sha256 } from '@noble/hashes/sha2.js';
import type { WebAuthnClient } from '@category-labs/mera';
import { verifyMessage } from 'viem';
import { describe, expect, it } from 'vitest';

import { createOwnerAccount, deriveSessionAccount, signInToOwnerAccount } from './passkey';

/**
 * A deterministic stand-in for a real authenticator, matching Mera's own
 * `WebAuthnClient` interface exactly (see the library's own
 * react-native-webauthn-client.ts, which swaps this same interface for
 * tests). One fixed "device secret" plus whatever salt is asked for
 * reproduces the same PRF output every time — the same property a real
 * authenticator has, without needing a browser or a physical device.
 */
function stubAuthenticator(): WebAuthnClient {
  const deviceSecret = sha256(new TextEncoder().encode('stub-device-secret'));
  const credentialId = new Uint8Array(32).fill(7);

  function prfFor(salt: Uint8Array): Uint8Array {
    return sha256(new Uint8Array([...deviceSecret, ...salt]));
  }

  return {
    async createCredential(request) {
      return {
        credentialId,
        transports: ['internal'],
        prfEnabled: true,
        prfOutput: prfFor(request.prfSalt),
      };
    },
    async getCredential(request) {
      return {
        credentialId,
        prfOutput: prfFor(request.prfSalt),
      };
    },
  };
}

const RP = { id: 'localhost', name: 'Entole (test)' };

describe('createOwnerAccount', () => {
  it('derives a real EVM address from the passkey', async () => {
    const account = await createOwnerAccount({
      rp: RP,
      displayName: 'Adaeze',
      webAuthnClient: stubAuthenticator(),
    });
    expect(account.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});

describe('signInToOwnerAccount', () => {
  it('re-derives the exact same address as account creation, same passkey', async () => {
    const client = stubAuthenticator();
    const created = await createOwnerAccount({ rp: RP, displayName: 'Adaeze', webAuthnClient: client });
    const signedIn = await signInToOwnerAccount({ rpId: RP.id, webAuthnClient: client });
    expect(signedIn.address).toBe(created.address);
  });
});

describe('deriveSessionAccount', () => {
  it('derives a different address than the owner account, same passkey', async () => {
    const client = stubAuthenticator();
    const owner = await createOwnerAccount({ rp: RP, displayName: 'Adaeze', webAuthnClient: client });
    const session = await deriveSessionAccount({ rpId: RP.id, webAuthnClient: client });
    expect(session.address).not.toBe(owner.address);
  });

  it('is itself deterministic — same passkey, same session address every time', async () => {
    const client = stubAuthenticator();
    const first = await deriveSessionAccount({ rpId: RP.id, webAuthnClient: client });
    const second = await deriveSessionAccount({ rpId: RP.id, webAuthnClient: client });
    expect(second.address).toBe(first.address);
  });
});

describe('the viem account can actually sign', () => {
  it('produces a signature that recovers to its own address', async () => {
    const account = await createOwnerAccount({
      rp: RP,
      displayName: 'Adaeze',
      webAuthnClient: stubAuthenticator(),
    });

    const message = 'Entole account verification';
    const signature = await account.viemAccount.signMessage({ message });

    const valid = await verifyMessage({ address: account.address, message, signature });
    expect(valid).toBe(true);

    account.end();
  });
});

describe('end()', () => {
  it('zeroes the session so a later sign throws', async () => {
    const account = await createOwnerAccount({
      rp: RP,
      displayName: 'Adaeze',
      webAuthnClient: stubAuthenticator(),
    });

    account.end();

    await expect(account.viemAccount.signMessage({ message: 'too late' })).rejects.toThrow();
  });
});
