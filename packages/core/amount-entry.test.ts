import { describe, expect, it } from 'vitest';

import {
  EMPTY_ENTRY,
  entryDisplay,
  entryFromMinor,
  entryToMinor,
  pressKey,
  type AmountEntry,
} from './amount-entry';
import { kobo, naira } from './money';

function type(keys: string): AmountEntry {
  return [...keys].reduce<AmountEntry>((entry, key) => pressKey(entry, key), EMPTY_ENTRY);
}

describe('keypad entry', () => {
  it('builds an amount from digits', () => {
    expect(entryToMinor(type('120000'))).toBe(naira(120_000));
  });

  it('keeps a leading zero from swallowing the amount', () => {
    expect(type('05').raw).toBe('5');
  });

  it('accepts at most two decimal places', () => {
    const entry = type('12.345');
    expect(entry.raw).toBe('12.34');
    expect(entryToMinor(entry)).toBe(kobo(1_234));
  });

  it('allows only one decimal point', () => {
    expect(type('1.2.3').raw).toBe('1.23');
  });

  it('starts a decimal entry at zero', () => {
    expect(pressKey(EMPTY_ENTRY, '.').raw).toBe('0.');
  });

  it('pads a single decimal digit', () => {
    expect(entryToMinor(type('1.5'))).toBe(kobo(150));
  });

  it('backspaces', () => {
    expect(pressKey(type('123'), '⌫').raw).toBe('12');
  });

  it('is empty at zero', () => {
    expect(entryToMinor(EMPTY_ENTRY)).toBe(kobo(0));
    expect(entryDisplay(EMPTY_ENTRY)).toBe('0');
  });

  it('caps the number of whole digits', () => {
    expect(type('12345678901').raw).toBe('123456789');
  });
});

describe('entryDisplay', () => {
  it('groups thousands while keeping the decimal as typed', () => {
    expect(entryDisplay(type('120000'))).toBe('120,000');
    expect(entryDisplay(type('1200.5'))).toBe('1,200.5');
  });
});

describe('entryFromMinor', () => {
  it('round-trips through minor units', () => {
    expect(entryToMinor(entryFromMinor(naira(50_000)))).toBe(naira(50_000));
    expect(entryFromMinor(kobo(5_000_025)).raw).toBe('50000.25');
  });
});
