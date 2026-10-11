import { oneOffAddress, oneOffName } from './one-off';
import { beneficiarySchema, type Beneficiary } from './records';

/** The longest name a saved person is given here. */
const NAME_MAX = 60;

export type SaveRecipientOutcome =
  | { ok: true; beneficiary: Beneficiary }
  | { ok: false; kind: 'no-name' }
  | { ok: false; kind: 'not-a-code' }
  | { ok: false; kind: 'already-saved'; as: Beneficiary };

/**
 * Turns someone just paid by their payment code into a beneficiary that can be
 * saved, so they can be paid again by name and given an allowance.
 *
 * The address comes from the code inside the one-off id and goes straight into
 * the record; nothing here hands it to a screen. Someone already saved under
 * the same code is found rather than saved twice.
 */
export function beneficiaryFromOneOff(input: {
  /** The one-off recipient id on the receipt, `code:PAY-…`. */
  recipientId: string;
  name: string;
  /** Everyone already saved. Decides duplicates and the avatar tone. */
  existing: Beneficiary[];
  id: string;
  now: Date;
}): SaveRecipientOutcome {
  const address = oneOffAddress(input.recipientId);
  if (!address) return { ok: false, kind: 'not-a-code' };

  const clash = input.existing.find((entry) => entry.address.toLowerCase() === address.toLowerCase());
  if (clash) return { ok: false, kind: 'already-saved', as: clash };

  const name = input.name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
  if (!name) return { ok: false, kind: 'no-name' };

  const parsed = beneficiarySchema.safeParse({
    id: input.id,
    name,
    address,
    tone: (input.existing.length % 3) + 1,
    createdAt: input.now.toISOString(),
  });
  return parsed.success ? { ok: true, beneficiary: parsed.data } : { ok: false, kind: 'not-a-code' };
}

/** The name to offer when saving: the one their payment link carried, if any. */
export function suggestedNameFor(recipientId: string): string {
  return oneOffName(recipientId) ?? '';
}
