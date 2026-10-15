import { gcm } from '@noble/ciphers/aes.js';
import { bytesToUtf8 } from '@noble/ciphers/utils.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { bytesToHex, hexToBytes, type Address } from 'viem';
import { z } from 'zod';

/**
 * The person's records, carried between their devices. The server side lives
 * in `apps/web/app/api/records`.
 *
 * Records used to stay on the device that made them, so signing in somewhere
 * new brought the account and its money and nothing else: no saved people, no
 * allowances, no invoices. Now every write is also sent to the server, and a
 * device that has none of them reads them back.
 *
 * What the server holds it cannot read. Each collection is sealed on the
 * device with AES-256-GCM under a key only the account's own passkey can
 * produce: the owner key's signature over a fixed sentence, run through HKDF.
 * That signature is deterministic (RFC 6979), so every device signed in to the
 * account makes the same key, and it never leaves the device; only signatures
 * over other sentences are ever sent. The collection's name is bound into the
 * seal, so one collection cannot be passed off as another.
 *
 * Every request is signed by the owner key, like the payments feed and the
 * assistant inbox, so nobody else can read or write an account's records.
 */

export const RECORD_COLLECTIONS = [
  'savings-principal',
  'activity',
  'allowances',
  'seats',
  'staff',
  'invoices',
  'beneficiaries',
  'tax-reserves',
] as const;

export type RecordCollection = (typeof RECORD_COLLECTIONS)[number];

export function isRecordCollection(value: string): value is RecordCollection {
  return (RECORD_COLLECTIONS as readonly string[]).includes(value);
}

/** A request signature older than this is refused. */
export const RECORDS_MAX_AGE_SECONDS = 300;
/** The most one sealed collection may be, as hex. Two hundred activity entries come to well under this. */
export const RECORD_CIPHERTEXT_MAX = 400_000;

/** The sentence whose signature becomes the sealing key. Never sent anywhere. */
export const RECORDS_KEY_MESSAGE = 'Entole records key\nversion: 1';

const NONCE_BYTES = 12;

/** The exact text a request is signed over, built the same way on the device and on the server. */
export function buildRecordsMessage(input: {
  account: Address;
  action: 'put' | 'get';
  collection?: string | undefined;
  at?: number | undefined;
  digest?: string | undefined;
  timestampSeconds: number;
}): string {
  return [
    'Entole records',
    `account: ${input.account.toLowerCase()}`,
    `action: ${input.action}`,
    `collection: ${input.collection ?? 'all'}`,
    `at: ${input.at ?? 'none'}`,
    `digest: ${input.digest ?? 'none'}`,
    `timestamp: ${input.timestampSeconds}`,
  ].join('\n');
}

/** What is signed for a sealed collection: its sha256, so the signature covers exactly what is stored. */
export function sealedDigest(ciphertext: string): string {
  return bytesToHex(sha256(utf8ToBytes(ciphertext)));
}

const sealedSchema = z
  .string()
  .regex(/^0x[0-9a-f]+$/)
  .max(RECORD_CIPHERTEXT_MAX);

export const storedCollectionSchema = z.object({
  at: z.number().int().positive(),
  ciphertext: sealedSchema,
});

export type StoredCollection = z.infer<typeof storedCollectionSchema>;

const pullAnswerSchema = z.object({
  collections: z.record(z.string(), storedCollectionSchema),
});

/** One collection as the device holds it: the text written, and when. */
export type SyncedValue = { value: string; at: number };

export type RecordSync = {
  /** Every collection the server holds for the account, opened. Empty when there is nothing or no server. */
  pull(): Promise<Partial<Record<RecordCollection, SyncedValue>>>;
  /** Sends one collection. Resolves either way; a failed send is tried again with the next write. */
  push(collection: RecordCollection, value: string, at: number): Promise<boolean>;
};

/** The sealing key for an account, from its owner's signature over `RECORDS_KEY_MESSAGE`. */
export function recordsKeyFrom(signature: `0x${string}`, account: Address): Uint8Array {
  return hkdf(sha256, hexToBytes(signature), utf8ToBytes('entole.records.v1'), utf8ToBytes(account.toLowerCase()), 32);
}

function aad(account: Address, collection: string): Uint8Array {
  return utf8ToBytes(`${account.toLowerCase()}:${collection}`);
}

export function sealRecord(key: Uint8Array, account: Address, collection: string, plain: string): string {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const sealed = gcm(key, nonce, aad(account, collection)).encrypt(utf8ToBytes(plain));
  const joined = new Uint8Array(nonce.length + sealed.length);
  joined.set(nonce);
  joined.set(sealed, nonce.length);
  return bytesToHex(joined);
}

/** The text sealed, or `null` when it was sealed under another key, for another collection, or altered. */
export function openRecord(key: Uint8Array, account: Address, collection: string, ciphertext: string): string | null {
  try {
    const bytes = hexToBytes(ciphertext as `0x${string}`);
    if (bytes.length <= NONCE_BYTES) return null;
    const plain = gcm(key, bytes.slice(0, NONCE_BYTES), aad(account, collection)).decrypt(bytes.slice(NONCE_BYTES));
    return bytesToUtf8(plain);
  } catch {
    return null;
  }
}

export function createRecordSync(options: {
  baseUrl: string;
  account: Address;
  sign: (message: string) => Promise<`0x${string}`>;
  fetch?: typeof fetch;
}): RecordSync {
  const fetchImpl = options.fetch ?? fetch;
  const url = `${options.baseUrl.replace(/\/$/, '')}/api/records`;
  let key: Promise<Uint8Array> | null = null;

  function sealingKey(): Promise<Uint8Array> {
    key ??= options.sign(RECORDS_KEY_MESSAGE).then((signature) => recordsKeyFrom(signature, options.account));
    key.catch(() => {
      key = null;
    });
    return key;
  }

  return {
    async pull() {
      try {
        const timestampSeconds = Math.floor(Date.now() / 1000);
        const signature = await options.sign(
          buildRecordsMessage({ account: options.account, action: 'get', timestampSeconds }),
        );
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ account: options.account, action: 'get', timestampSeconds, signature }),
        });
        if (!response.ok) return {};
        const parsed = pullAnswerSchema.safeParse(await response.json());
        if (!parsed.success) return {};
        const sealing = await sealingKey();
        const opened: Partial<Record<RecordCollection, SyncedValue>> = {};
        for (const [collection, stored] of Object.entries(parsed.data.collections)) {
          if (!isRecordCollection(collection)) continue;
          const value = openRecord(sealing, options.account, collection, stored.ciphertext);
          if (value !== null) opened[collection] = { value, at: stored.at };
        }
        return opened;
      } catch {
        return {};
      }
    },

    async push(collection, value, at) {
      try {
        const ciphertext = sealRecord(await sealingKey(), options.account, collection, value);
        if (ciphertext.length > RECORD_CIPHERTEXT_MAX) return false;
        const timestampSeconds = Math.floor(Date.now() / 1000);
        const signature = await options.sign(
          buildRecordsMessage({
            account: options.account,
            action: 'put',
            collection,
            at,
            digest: sealedDigest(ciphertext),
            timestampSeconds,
          }),
        );
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            account: options.account,
            action: 'put',
            collection,
            at,
            ciphertext,
            timestampSeconds,
            signature,
          }),
        });
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}
