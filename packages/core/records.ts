import { getAddress, isAddress, type Address } from 'viem';
import { z } from 'zod';

import { decodePaymentCode } from './payment-code';
import { initialsFor } from './profile';
import {
  activitySchema,
  allowanceSchema,
  avatarToneSchema,
  invoiceSchema,
  type Activity,
  type Allowance,
  type Contact,
  type Invoice,
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

/** Someone the business pays regularly. Just a person and their payment code —
 * no address, no role, no permission. `payAmountMinor` and `cadence` are only
 * what the owner wants pre-filled when running payroll; nothing pays on its own. */
export const staffSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Canonical `PAY-XXXX-…`. Validated, so a mistyped code never reaches a payment. */
  code: z.string().refine((value) => decodePaymentCode(value) !== null, 'not a payment code'),
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

/** One owner's records. Keyed by the account, so two accounts on the same
 * phone never see each other's people or history. */
export function createRecords(store: RecordStore, owner: Address) {
  const chunked = chunkedStore(store);
  const key = (collection: string) => `entole.records.${owner.toLowerCase()}.${collection}`;

  async function write<T>(collection: string, list: T[]) {
    await chunked.set(key(collection), JSON.stringify(list));
  }

  return {
    activity: {
      list: () => readList(chunked, key('activity'), activitySchema),
      async add(entry: Activity) {
        const current = await readList(chunked, key('activity'), activitySchema);
        const next = [entry, ...current.filter((item) => item.id !== entry.id)].slice(0, ACTIVITY_LIMIT);
        await write('activity', next);
      },
    },
    allowances: {
      list: () => readList(chunked, key('allowances'), allowanceSchema),
      async upsert(entry: Allowance) {
        const current = await readList(chunked, key('allowances'), allowanceSchema);
        const exists = current.some((item) => item.id === entry.id);
        await write('allowances', exists ? current.map((item) => (item.id === entry.id ? entry : item)) : [...current, entry]);
      },
      async remove(id: string) {
        const current = await readList(chunked, key('allowances'), allowanceSchema);
        await write('allowances', current.filter((item) => item.id !== id));
      },
    },
    staff: {
      list: () => readList(chunked, key('staff'), staffSchema),
      async upsert(input: Staff) {
        const entry = staffSchema.parse(input); // never store what would not read back
        const current = await readList(chunked, key('staff'), staffSchema);
        const exists = current.some((item) => item.id === entry.id);
        await write('staff', exists ? current.map((item) => (item.id === entry.id ? entry : item)) : [...current, entry]);
      },
      /** Adds or replaces many at once in a single write — an import is all or nothing. */
      async upsertMany(inputs: Staff[]) {
        const entries = inputs.map((entry) => staffSchema.parse(entry));
        const current = await readList(chunked, key('staff'), staffSchema);
        const byId = new Map(current.map((item) => [item.id, item]));
        for (const entry of entries) byId.set(entry.id, entry);
        await write('staff', [...byId.values()]);
      },
      async remove(id: string) {
        const current = await readList(chunked, key('staff'), staffSchema);
        await write('staff', current.filter((item) => item.id !== id));
      },
    },
    invoices: {
      /** Newest first. */
      list: () => readList(chunked, key('invoices'), invoiceSchema),
      async upsert(input: Invoice) {
        const entry = invoiceSchema.parse(input);
        const current = await readList(chunked, key('invoices'), invoiceSchema);
        const exists = current.some((item) => item.id === entry.id);
        await write('invoices', exists ? current.map((item) => (item.id === entry.id ? entry : item)) : [entry, ...current]);
      },
      async remove(id: string) {
        const current = await readList(chunked, key('invoices'), invoiceSchema);
        await write('invoices', current.filter((item) => item.id !== id));
      },
    },
    beneficiaries: {
      list: () => readList(chunked, key('beneficiaries'), beneficiarySchema),
      async upsert(entry: Beneficiary) {
        const current = await readList(chunked, key('beneficiaries'), beneficiarySchema);
        const exists = current.some((item) => item.id === entry.id);
        await write('beneficiaries', exists ? current.map((item) => (item.id === entry.id ? entry : item)) : [...current, entry]);
      },
      async remove(id: string) {
        const current = await readList(chunked, key('beneficiaries'), beneficiarySchema);
        await write('beneficiaries', current.filter((item) => item.id !== id));
      },
    },
  };
}
