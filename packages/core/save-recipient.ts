import { oneOffAddress, oneOffName } from './one-off';
import { beneficiarySchema, type Beneficiary } from './records';

/** The longest name a saved person is given here. */
const NAME_MAX = 60;

export type SaveRecipientOutcome =
  | { ok: true; beneficiary: Beneficiary }
  | { ok: false; kind: 'no-name' }
  | { ok: false; kind: 'not-a-code' }
  | { ok: false; kind: 'already-saved'; as: Beneficiary };

/** A typed name or nickname, tidied: one space between words, no longer than a name is. */
function tidy(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
}

/**
 * Turns someone just paid into a beneficiary that can be saved, so they can be
 * paid again in a couple of taps and given an allowance.
 *
 * Their name is the one they were found under, which the directory gave. The
 * person saving them is asked for nothing but an optional nickname: what they
 * call them, and what they will see when they pay them.
 *
 * The address comes from inside the one-off id and goes straight into the
 * record; nothing here hands it to a screen. Someone already saved under the
 * same account is found rather than saved twice.
 */
export function beneficiaryFromOneOff(input: {
  /** The one-off recipient id on the receipt. */
  recipientId: string;
  /** Who they are. Asked for only when nothing named them. */
  name: string;
  /** What the person saving them calls them, if anything. */
  nickname?: string;
  /** Everyone already saved. Decides duplicates and the avatar tone. */
  existing: Beneficiary[];
  id: string;
  now: Date;
}): SaveRecipientOutcome {
  const address = oneOffAddress(input.recipientId);
  if (!address) return { ok: false, kind: 'not-a-code' };

  const clash = input.existing.find((entry) => entry.address.toLowerCase() === address.toLowerCase());
  if (clash) return { ok: false, kind: 'already-saved', as: clash };

  const name = tidy(input.name);
  if (!name) return { ok: false, kind: 'no-name' };
  const nickname = tidy(input.nickname);

  const parsed = beneficiarySchema.safeParse({
    id: input.id,
    name,
    ...(nickname && nickname !== name ? { nickname } : {}),
    address,
    tone: (input.existing.length % 3) + 1,
    createdAt: input.now.toISOString(),
  });
  return parsed.success ? { ok: true, beneficiary: parsed.data } : { ok: false, kind: 'not-a-code' };
}

/** Who they are, as they were found: the name the directory has for them, or nothing. */
export function suggestedNameFor(recipientId: string): string {
  return oneOffName(recipientId) ?? '';
}
