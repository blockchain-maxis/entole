import { getAddress, type Address } from 'viem';

import type { Rate } from './fx';
import { oneOffAddress } from './one-off';
import { beneficiaryAddress, toContact, type Beneficiary, type Records, type Staff } from './records';
import { snapshotSchema, type Snapshot } from './schemas';

/**
 * What the app knows about the person's account *off* the chain: who they pay,
 * the allowances they made and what they've sent — all from this device's own
 * records, all empty for a new account. The on-chain gateway adds the parts the
 * chain owns (the balance, whether it's paused, how much of each allowance is
 * spent). Nothing here is a fixture, and nothing is invented to fill a screen.
 *
 * Also owns the private lookup from a beneficiary to where their money lands,
 * so an address never travels alongside the `Contact` a screen renders.
 */
export function createAccountSource(options: { records: Records; getRate: () => Promise<Rate> }) {
  let addresses = new Map<string, Address>();
  let ids = new Map<string, string>();

  function index(beneficiaries: Beneficiary[]) {
    addresses = new Map(beneficiaries.map((b) => [b.id, beneficiaryAddress(b)]));
    ids = new Map(beneficiaries.map((b) => [beneficiaryAddress(b).toLowerCase(), b.id]));
  }

  return {
    async loadSnapshot(): Promise<Snapshot> {
      const [rate, beneficiaries, allowances, activity, invoices] = await Promise.all([
        options.getRate(),
        options.records.beneficiaries.list(),
        options.records.allowances.list(),
        options.records.activity.list(),
        options.records.invoices.list(),
      ]);
      index(beneficiaries);

      return snapshotSchema.parse({
        // The balance and paused flag are read from the chain by the gateway.
        account: { balanceMinor: 0, koboPerDollar: rate.koboPerDollar, paused: false },
        contacts: beneficiaries.map(toContact),
        allowances,
        activity,
        seats: [],
        invoices,
        procurementRequests: [],
        taxReserves: [],
        growPosition: null,
        stockPositions: [],
        request: null,
        proposal: null,
      });
    },

    /** Where a beneficiary's (or a one-off payment code's) money lands. Never rendered. */
    resolveRecipient(contactId: string): Address {
      // A payment code paid without saving the person first.
      const address = addresses.get(contactId) ?? oneOffAddress(contactId);
      if (!address) throw new Error("We couldn't find that beneficiary.");
      return address;
    },

    resolveContactId(address: Address): string | undefined {
      return ids.get(getAddress(address).toLowerCase());
    },

    /** The full records, for the screen where beneficiaries are managed. Never
     * rendered as-is: the address inside is only for `resolveRecipient`. */
    async listBeneficiaries(): Promise<Beneficiary[]> {
      const list = await options.records.beneficiaries.list();
      index(list);
      return list;
    },

    /** The people the business pays regularly. Codes only — never an address. */
    listStaff: () => options.records.staff.list(),
    saveStaff: (person: Staff) => options.records.staff.upsert(person),
    /** Merges an import in one write: existing people (same id) are updated. */
    saveManyStaff: (people: Staff[]) => options.records.staff.upsertMany(people),
    removeStaff: (id: string) => options.records.staff.remove(id),

    /** Saves a beneficiary and makes it payable straight away. */
    async saveBeneficiary(beneficiary: Beneficiary): Promise<void> {
      await options.records.beneficiaries.upsert(beneficiary);
      index(await options.records.beneficiaries.list());
    },

    async removeBeneficiary(id: string): Promise<void> {
      await options.records.beneficiaries.remove(id);
      index(await options.records.beneficiaries.list());
    },
  };
}

export type AccountSource = ReturnType<typeof createAccountSource>;
