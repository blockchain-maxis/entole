import { formatNaira, kobo } from './money';

/**
 * A movement of the person's own money, as the app is about to make it. Each
 * one is confirmed by the person first: a fingerprint, a face or the screen
 * lock on a phone, their passkey in a browser.
 *
 * The assistant's own payments are not in this list. Its limits are the
 * allowance, set by the person with this same confirmation, and the person's
 * check on each run is the undo window.
 */
export type Movement =
  | { kind: 'send'; amountMinor: number }
  /** Several payments confirmed as one, as when paying a list of people. */
  | { kind: 'send-many'; totalMinor: number; count: number }
  | { kind: 'bill'; amountMinor: number }
  | { kind: 'save'; amountMinor: number }
  | { kind: 'take-out'; amountMinor: number }
  | { kind: 'allowance'; limitMinor: number };

/** What the confirmation prompt says is about to happen. */
export function describeMovement(movement: Movement): string {
  switch (movement.kind) {
    case 'send':
      return `Send ${formatNaira(kobo(movement.amountMinor))}`;
    case 'send-many':
      return `Pay ${movement.count} ${movement.count === 1 ? 'person' : 'people'} ${formatNaira(kobo(movement.totalMinor))}`;
    case 'bill':
      return `Pay a bill of ${formatNaira(kobo(movement.amountMinor))}`;
    case 'save':
      return `Add ${formatNaira(kobo(movement.amountMinor))} to savings`;
    case 'take-out':
      return `Take ${formatNaira(kobo(movement.amountMinor))} out of savings`;
    case 'allowance':
      return `Let the assistant spend up to ${formatNaira(kobo(movement.limitMinor))}`;
  }
}

/** Raised when the person did not confirm. Its message is fit to show as it is. */
export class MovementNotConfirmedError extends Error {
  constructor(message = 'Not confirmed. Nothing was moved.') {
    super(message);
    this.name = 'MovementNotConfirmedError';
  }
}

/**
 * Asks the person to confirm a movement. Resolves to let it go ahead; rejects
 * with `MovementNotConfirmedError` to stop it before anything is signed.
 */
export type ConfirmMovement = (movement: Movement) => Promise<void>;
