import { kobo, type Naira } from './money';

/**
 * Amount entry never goes through a float. Digits are kept as typed and folded
 * into minor units with integer arithmetic only.
 */

export type AmountEntry = {
  /** Digits exactly as typed, e.g. "120000" or "1200.5". Never parsed as a float. */
  raw: string;
};

export const EMPTY_ENTRY: AmountEntry = { raw: '' };

const MAX_WHOLE_DIGITS = 9;

export type KeypadKey = string;

/** The keypad's own layout — 1-9, decimal point, 0, backspace. */
export const KEYPAD_KEYS: readonly KeypadKey[] = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '.',
  '0',
  '⌫',
];

export function pressKey(entry: AmountEntry, key: KeypadKey): AmountEntry {
  if (key === '⌫') return { raw: entry.raw.slice(0, -1) };

  if (key === '.') {
    if (entry.raw.includes('.')) return entry;
    return { raw: entry.raw === '' ? '0.' : `${entry.raw}.` };
  }

  const [whole = '', fraction] = entry.raw.split('.');

  if (fraction === undefined) {
    if (whole.length >= MAX_WHOLE_DIGITS) return entry;
    if (whole === '0') return { raw: key };
    return { raw: whole + key };
  }

  if (fraction.length >= 2) return entry;
  return { raw: `${whole}.${fraction}${key}` };
}

export function entryToMinor(entry: AmountEntry): Naira {
  if (entry.raw === '') return kobo(0);
  const [whole = '0', fraction = ''] = entry.raw.split('.');
  const wholePart = whole === '' ? 0 : Number(whole);
  const fractionPart = Number(fraction.padEnd(2, '0').slice(0, 2) || '0');
  return kobo(wholePart * 100 + fractionPart);
}

export function entryFromMinor(value: Naira): AmountEntry {
  const whole = Math.trunc(value / 100);
  const fraction = value % 100;
  return { raw: fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, '0')}` };
}

/** What the amount field shows: grouped digits, with the decimal kept as typed. */
export function entryDisplay(entry: AmountEntry): string {
  if (entry.raw === '') return '0';
  const [whole = '', fraction] = entry.raw.split('.');
  const grouped = (whole === '' ? '0' : whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}
