import type { BillCategory } from './bill-payment';
import type { Contact } from './schemas';

/**
 * What the Pay hub shows around `bill-payment.ts` and the send flow — pure
 * presentation data and lookups, shared by both apps so a category's label
 * or a corridor's members are named in exactly one place.
 */

export type BillCategoryInfo = {
  id: BillCategory;
  label: string;
  /** What the person types to say whose bill this is. */
  identifierLabel: string;
  hint: string;
};

/** Generic categories only — no invented provider names. */
export const BILL_CATEGORIES: readonly BillCategoryInfo[] = [
  { id: 'electricity', label: 'Electricity', identifierLabel: 'Meter number', hint: 'Prepaid or postpaid' },
  { id: 'airtime-data', label: 'Airtime & Data', identifierLabel: 'Phone number', hint: 'Top up any line' },
  { id: 'cable-tv', label: 'Cable TV', identifierLabel: 'Decoder or smart card number', hint: 'Renew a subscription' },
  { id: 'internet', label: 'Internet', identifierLabel: 'Account number', hint: 'Home and office plans' },
];

export function billCategory(id: string | undefined): BillCategoryInfo | undefined {
  return BILL_CATEGORIES.find((category) => category.id === id);
}

export type Corridor = {
  id: string;
  label: string;
  contacts: Contact[];
};

/** Every corridor Entole names, and the places a contact's `place` reads as
 * when they live there. A corridor only appears once at least one real
 * contact is on the other end of it — nothing is listed that can't be sent
 * to. */
const CORRIDOR_DEFS: readonly { id: string; label: string; places: readonly string[] }[] = [
  { id: 'uk', label: 'United Kingdom', places: ['London', 'Manchester', 'Birmingham'] },
  { id: 'us', label: 'United States', places: ['New York', 'Houston', 'Atlanta'] },
  { id: 'ca', label: 'Canada', places: ['Toronto', 'Calgary'] },
];

/** `place` is written the way the recipient would say it — "Lagos · Zenith
 * Bank" — so only the part before the first separator names the city. */
function cityOf(place: string | undefined): string | undefined {
  return place?.split('·')[0]?.trim();
}

export function corridorsFor(contacts: readonly Contact[]): Corridor[] {
  return CORRIDOR_DEFS.flatMap((definition) => {
    const members = contacts.filter((contact) => {
      const city = cityOf(contact.place);
      return city !== undefined && definition.places.includes(city);
    });
    return members.length > 0 ? [{ id: definition.id, label: definition.label, contacts: members }] : [];
  });
}
