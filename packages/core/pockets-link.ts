import { POCKETS, type PocketId } from './intents-pockets';

/**
 * A pockets sheet to open on arrival, filled in, from a link such as Ayo's
 * `money?change=1&from=usd&to=eur&amount=10000`. It only fills in: a change
 * is still quoted first and confirmed by the person, and adding still shows
 * the code to pay in from.
 */
export type PocketsOpening =
  | { sheet: 'change'; from?: PocketId; to?: PocketId; amountCents?: number }
  | { sheet: 'add'; pocket?: PocketId };

const POCKET_IDS = new Set<string>(POCKETS.map((pocket) => pocket.id));
const asPocket = (value: string | null | undefined): PocketId | undefined =>
  value && POCKET_IDS.has(value) ? (value as PocketId) : undefined;

/** What a link asks to open, from its query values. Anything it does not know is ignored. */
export function pocketsOpeningFrom(get: (key: string) => string | null | undefined): PocketsOpening | null {
  if (get('change') === '1') {
    const amount = Number(get('amount'));
    const from = asPocket(get('from'));
    const to = asPocket(get('to'));
    return {
      sheet: 'change',
      ...(from ? { from } : {}),
      ...(to && to !== from ? { to } : {}),
      ...(Number.isInteger(amount) && amount > 0 && amount <= 1_000_000_000 ? { amountCents: amount } : {}),
    };
  }
  const add = get('add');
  if (!add) return null;
  const pocket = asPocket(add);
  return { sheet: 'add', ...(pocket ? { pocket } : {}) };
}
