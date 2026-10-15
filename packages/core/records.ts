import { getAddress, isAddress, type Address } from 'viem';
import { z } from 'zod';

import { decodePaymentCode } from './payment-code';
import { initialsFor } from './profile';
import { RECORD_COLLECTIONS, type RecordCollection, type RecordSync } from './record-sync';
import {
  activitySchema,
  allowanceSchema,
  avatarToneSchema,
  invoiceSchema,
  seatSchema,
  taxReserveSchema,
  type Activity,
  type Allowance,
  type Contact,
  type Invoice,
  type Seat,
  type TaxReserve,
} from './schemas';

/**
 * The records that belong to the person, kept on their device: who they pay,
 * the allowances they created and what they've sent. Nothing here is invented
 * and nothing resets — a new account starts empty.
 *
 * Storage sits behind `RecordStore` so a backend can replace it later without a
 * screen noticing. Every value read back is parsed, never trusted.
 */
export interface RecordStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Keychain-backed stores warn (and on some devices refuse) above ~2 KB per
 * value, so a long list is split across several keys. */
const CHUNK_SIZE = 1_500;

export function chunkedStore(base: RecordStore): RecordStore {
  const countKey = (key: string) => `${key}.n`;
  const partKey = (key: string, index: number) => `${key}.${index}`;

  async function remove(key: string): Promise<void> {
    const count = Number((await base.get(countKey(key))) ?? 0);
    for (let index = 0; index < count; index += 1) await base.remove(partKey(key, index));
    await base.remove(countKey(key));
  }

  return {
    async get(key) {
      const count = Number((await base.get(countKey(key))) ?? 0);
      if (!count) return null;
      const parts: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const part = await base.get(partKey(key, index));
        if (part === null) return null;
        parts.push(part);
      }
      return parts.join('');
    },
    async set(key, value) {
      const previous = Number((await base.get(countKey(key))) ?? 0);
      const parts = value.match(new RegExp(`[\\s\\S]{1,${CHUNK_SIZE}}`, 'g')) ?? [];
      for (const [index, part] of parts.entries()) await base.set(partKey(key, index), part);
      for (let index = parts.length; index < previous; index += 1) await base.remove(partKey(key, index));
      await base.set(countKey(key), String(parts.length));
    },
    remove,
  };
}

/** Someone the person sends money to. `address` is how the money reaches them;
 * it stays in this record and never reaches a screen — `toContact` is the only
 * shape the UI ever sees. Bank details are recorded for later cash-out; nothing
 * uses them to move money today. */
export const beneficiarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  nickname: z.string().min(1).optional(),
  /** ISO 3166-1 alpha-2. */
  country: z.string().length(2).optional(),
  address: z.string().refine((value) => isAddress(value), 'not an address'),
  bank: z
    .object({
      bankName: z.string().min(1),
      accountNumber: z.string().min(1),
      accountName: z.string().min(1).optional(),
    })
    .optional(),
  tone: avatarToneSchema,
  createdAt: z.string().datetime({ offset: true }),
});

export type Beneficiary = z.infer<typeof beneficiarySchema>;

export function toContact(beneficiary: Beneficiary): Contact {
  const shown = beneficiary.nickname ?? beneficiary.name;
  return {
    id: beneficiary.id,
    name: shown,
    initials: initialsFor(shown),
    ...(beneficiary.country ? { place: beneficiary.country } : {}),
    tone: beneficiary.tone,
  };
}

export function beneficiaryAddress(beneficiary: Beneficiary): Address {
  return getAddress(beneficiary.address);
}

/** Someone the business pays regularly. Just a person and where their pay
 * goes — no role, no permission. `payAmountMinor` and `cadence` are only what
 * the owner wants pre-filled when running payroll; nothing pays on its own. */
export const staffSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Their account, in the form records keep it (`PAY-XXXX-…`). Validated, so a
   * bad one never reaches a payment. Never put on a screen. */
  code: z.string().refine((value) => decodePaymentCode(value) !== null, 'not a payment code'),
  /** The username or number they were added by, as a person writes it
   * ("@ada.eze", "0803 123 4567"). This is what a screen shows for them. */
  handle: z.string().min(1).max(40).optional(),
  payAmountMinor: z.number().int().positive().optional(),
  cadence: z.enum(['weekly', 'monthly']).nullable(),
  note: z.string().min(1).optional(),
  createdAt: z.string().datetime({ offset: true }),
});

export type Staff = z.infer<typeof staffSchema>;

const ACTIVITY_LIMIT = 200;

export type Records = ReturnType<typeof createRecords>;

async function readList<T>(store: RecordStore, key: string, schema: z.ZodType<T>): Promise<T[]> {
  const raw = await store.get(key);
  if (!raw) return [];
  try {
    const parsed = z.array(schema).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** Whether a collection read from elsewhere is at least a JSON list. Each entry is still parsed on read. */
function isJsonList(value: string): boolean {
  try {
    return Array.isArray(JSON.parse(value));
  } catch {
    return false;
  }
}

/** How long the first read waits on the server before going on with what the device has. */
const PULL_WAIT_MS = 4_000;

/**
 * One owner's records. Keyed by the account, so two accounts on the same
 * phone never see each other's people or history.
 *
 * With `sync`, they also follow the account between devices
 * (`record-sync.ts`). Every collection carries when it was last written; a
 * write here is sent on, and the first read on a device asks the server for
 * anything newer. The newer copy of a collection wins, whole. The device's
 * own copy is always what is read, so nothing waits on the network for more
 * than a moment, and without a server nothing changes.
 */
export function createRecords(store: RecordStore, owner: Address, sync?: RecordSync) {
  const chunked = chunkedStore(store);
  const key = (collection: string) => `entole.records.${owner.toLowerCase()}.${collection}`;
  const atKey = (collection: string) => `${key(collection)}.at`;

  async function writtenAt(collection: RecordCollection): Promise<number> {
    const raw = await store.get(atKey(collection));
    return raw && /^\d+$/.test(raw) ? Number(raw) : 0;
  }

  async function localValue(collection: RecordCollection): Promise<string | null> {
    return collection === 'savings-principal' ? store.get(key(collection)) : chunked.get(key(collection));
  }

  async function setLocal(collection: RecordCollection, value: string, at: number): Promise<void> {
    if (collection === 'savings-principal') await store.set(key(collection), value);
    else await chunked.set(key(collection), value);
    await store.set(atKey(collection), String(at));
  }

  /** Takes in what the server has that is newer, and sends on what the device has that the server lacks. */
  async function exchange(): Promise<void> {
    if (!sync) return;
    const remote = await sync.pull();
    for (const collection of RECORD_COLLECTIONS) {
      const theirs = remote[collection];
      const mine = await writtenAt(collection);
      if (theirs && theirs.at > mine) {
        // A collection that would not read back is not taken in.
        if (collection === 'savings-principal' ? /^\d+$/.test(theirs.value) : isJsonList(theirs.value)) {
          await setLocal(collection, theirs.value, theirs.at);
        }
      } else if (!theirs || mine > theirs.at) {
        const value = await localValue(collection);
        if (value === null) continue;
        // Written before records were sent anywhere: it has no date, so it is dated now.
        const at = mine || Date.now();
        if (!mine) await store.set(atKey(collection), String(at));
        await sync.push(collection, value, at);
      }
    }
  }

  let exchanged: Promise<void> | null = null;
  function ready(): Promise<void> {
    if (!sync) return Promise.resolve();
    exchanged ??= exchange().catch(() => undefined);
    return Promise.race([exchanged, new Promise<void>((resolve) => setTimeout(resolve, PULL_WAIT_MS))]);
  }

  async function save(collection: RecordCollection, value: string) {
    await ready();
    const at = Math.max(Date.now(), (await writtenAt(collection)) + 1);
    await setLocal(collection, value, at);
    void sync?.push(collection, value, at);
  }

  async function write<T>(collection: RecordCollection, list: T[]) {
    await save(collection, JSON.stringify(list));
  }

  async function read<T>(collection: RecordCollection, schema: z.ZodType<T>): Promise<T[]> {
    await ready();
    return readList(chunked, key(collection), schema);
  }

  return {
    /** What the person has put into savings and not yet taken out, in the
     * settlement asset's base units. It is what lets earnings be told apart
     * from their own money. Kept with the other records, so it follows the
     * account to a new device when records are synced. */
    savings: {
      async principal(): Promise<bigint | null> {
        await ready();
        const raw = await store.get(key('savings-principal'));
        return raw && /^\d+$/.test(raw) ? BigInt(raw) : null;
      },
      async setPrincipal(units: bigint): Promise<void> {
        await save('savings-principal', (units < 0n ? 0n : units).toString());
      },
    },
    activity: {
      list: () => read('activity', activitySchema),
      async add(entry: Activity) {
        const current = await read('activity', activitySchema);
        const next = [entry, ...current.filter((item) => item.id !== entry.id)].slice(0, ACTIVITY_LIMIT);
        await write('activity', next);
      },
      /**
       * Takes in entries that were not made on this device: payments that
       * arrived. They may be older than what is already here, so the list is
       * put back in order of when things happened, newest first. An entry
       * already kept is left exactly as it is. Returns the ones that were new.
       */
      async merge(entries: Activity[]): Promise<Activity[]> {
        if (entries.length === 0) return [];
        const current = await read('activity', activitySchema);
        const have = new Set(current.map((item) => item.id));
        const fresh = entries.filter((entry, index) => !have.has(entry.id) && entries.findIndex((e) => e.id === entry.id) === index);
        if (fresh.length === 0) return [];
        const next = [...fresh, ...current]
          .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
          .slice(0, ACTIVITY_LIMIT);
        await write('activity', next);
        return fresh;
      },
    },
    allowances: {
      list: () => read('allowances', allowanceSchema),
      async upsert(entry: Allowance) {
        const current = await read('allowances', allowanceSchema);
        const exists = current.some((item) => item.id === entry.id);
        await write('allowances', exists ? current.map((item) => (item.id === entry.id ? entry : item)) : [...current, entry]);
      },
      async remove(id: string) {
        const current = await read('allowances', allowanceSchema);
        await write('allowances', current.filter((item) => item.id !== id));
      },
    },
    seats: {
      list: () => read('seats', seatSchema),
      async upsert(input: Seat) {
        const entry = seatSchema.parse(input); // never store what would not read back
        const current = await read('seats', seatSchema);
        const exists = current.some((item) => item.id === entry.id);
        await write('seats', exists ? current.map((item) => (item.id === entry.id ? entry : item)) : [...current, entry]);
      },
      async remove(id: string) {
        const current = await read('seats', seatSchema);
        await write('seats', current.filter((item) => item.id !== id));
      },
    },
    staff: {
      list: () => read('staff', staffSchema),
      async upsert(input: Staff) {
        const entry = staffSchema.parse(input); // never store what would not read back
        const current = await read('staff', staffSchema);
        const exists = current.some((item) => item.id === entry.id);
        await write('staff', exists ? current.map((item) => (item.id === entry.id ? entry : item)) : [...current, entry]);
      },
      /** Adds or replaces many at once in a single write — an import is all or nothing. */
      async upsertMany(inputs: Staff[]) {
        const entries = inputs.map((entry) => staffSchema.parse(entry));
        const current = await read('staff', staffSchema);
        const byId = new Map(current.map((item) => [item.id, item]));
        for (const entry of entries) byId.set(entry.id, entry);
        await write('staff', [...byId.values()]);
      },
      async remove(id: string) {
        const current = await read('staff', staffSchema);
        await write('staff', current.filter((item) => item.id !== id));
      },
    },
    invoices: {
      /** Newest first. */
      list: () => read('invoices', invoiceSchema),
      async upsert(input: Invoice) {
        const entry = invoiceSchema.parse(input);
        const current = await read('invoices', invoiceSchema);
        const exists = current.some((item) => item.id === entry.id);
        await write('invoices', exists ? current.map((item) => (item.id === entry.id ? entry : item)) : [entry, ...current]);
      },
      async remove(id: string) {
        const current = await read('invoices', invoiceSchema);
        await write('invoices', current.filter((item) => item.id !== id));
      },
    },
    taxReserves: {
      /** Newest first. */
      list: () => read('tax-reserves', taxReserveSchema),
      /** Adds or replaces one; one reserve per invoice. */
      async upsert(input: TaxReserve) {
        const entry = taxReserveSchema.parse(input);
        const current = await read('tax-reserves', taxReserveSchema);
        const exists = current.some((item) => item.id === entry.id);
        await write('tax-reserves', exists ? current.map((item) => (item.id === entry.id ? entry : item)) : [entry, ...current]);
      },
    },
    beneficiaries: {
      list: () => read('beneficiaries', beneficiarySchema),
      async upsert(entry: Beneficiary) {
        const current = await read('beneficiaries', beneficiarySchema);
        const exists = current.some((item) => item.id === entry.id);
        await write('beneficiaries', exists ? current.map((item) => (item.id === entry.id ? entry : item)) : [...current, entry]);
      },
      async remove(id: string) {
        const current = await read('beneficiaries', beneficiarySchema);
        await write('beneficiaries', current.filter((item) => item.id !== id));
      },
    },
  };
}
