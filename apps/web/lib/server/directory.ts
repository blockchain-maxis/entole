import { Redis } from '@upstash/redis';
import type { Address } from 'viem';

/**
 * The identity directory: `address -> {name, initials, tone, phone?, username?}`
 * and two pointers back to an address: `phone -> address`, so a payment link
 * like `/ng/8012345678` resolves to who to actually pay, and
 * `username -> address`, which is what makes a username one person's. Server-only —
 * lazy so a build with no Redis provisioned yet doesn't crash (see the Neon
 * build-time-safety note this mirrors: reading `process.env` at call time,
 * not module load time).
 */

let client: Redis | null = null;

function redis(): Redis | null {
  if (client) return client;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  client = new Redis({ url, token });
  return client;
}

export type DirectoryRecord = {
  address: Address;
  name: string;
  initials: string;
  tone: 1 | 2 | 3;
  phone?: { country: string; number: string };
  username?: string;
  updatedAt: string;
};

const addressKey = (address: Address) => `directory:addr:${address.toLowerCase()}`;
const phoneKey = (country: string, number: string) => `directory:phone:${country.toLowerCase()}:${number}`;
const usernameKey = (username: string) => `directory:user:${username.toLowerCase()}`;

export function directoryConfigured(): boolean {
  return redis() !== null;
}

export async function getByAddress(address: Address): Promise<DirectoryRecord | null> {
  const db = redis();
  if (!db) return null;
  return (await db.get<DirectoryRecord>(addressKey(address))) ?? null;
}

/** The address a claimed phone number resolves to, or `null` if unclaimed. */
export async function getPhoneOwner(country: string, number: string): Promise<Address | null> {
  const db = redis();
  if (!db) return null;
  return (await db.get<Address>(phoneKey(country, number))) ?? null;
}

/** The address a username belongs to, or `null` if nobody has it. */
export async function getUsernameOwner(username: string): Promise<Address | null> {
  const db = redis();
  if (!db) return null;
  return (await db.get<Address>(usernameKey(username))) ?? null;
}

/**
 * Takes a username for an address if nobody holds it, in one step, so two
 * people claiming the same name at the same moment cannot both get it. Says
 * whether this address holds it afterwards (true as well when it already did).
 */
export async function claimUsername(username: string, address: Address): Promise<boolean> {
  const db = redis();
  if (!db) throw new Error('not_configured');
  await db.set(usernameKey(username), address, { nx: true });
  const owner = await db.get<Address>(usernameKey(username));
  return owner?.toLowerCase() === address.toLowerCase();
}

/**
 * Writes the record and, if a phone is included, its reverse pointer. Caller
 * has already checked the phone isn't claimed by a different address —
 * first claim locks it, and only the claiming address can ever update it.
 */
export async function saveRecord(record: DirectoryRecord): Promise<void> {
  const db = redis();
  if (!db) throw new Error('not_configured');
  const previous = await getByAddress(record.address);
  const pipeline = db.pipeline();
  pipeline.set(addressKey(record.address), record);
  if (record.phone) pipeline.set(phoneKey(record.phone.country, record.phone.number), record.address);
  // Changing numbers: drop the old pointer so it doesn't keep resolving here.
  if (previous?.phone && (!record.phone || previous.phone.number !== record.phone.number)) {
    pipeline.del(phoneKey(previous.phone.country, previous.phone.number));
  }
  // Changing usernames: the old one goes back to being anyone's. The new one's
  // pointer was already taken by `claimUsername` before this was called.
  if (previous?.username && previous.username !== record.username) {
    pipeline.del(usernameKey(previous.username));
  }
  await pipeline.exec();
}
