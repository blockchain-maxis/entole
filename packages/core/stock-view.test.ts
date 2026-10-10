import { describe, expect, it } from 'vitest';

import type { StockListItem } from './stock-market';
import {
  appendStockPage,
  changeTone,
  formatPercent,
  formatStockDay,
  formatStockMoment,
  historyChange,
  historyLine,
  stockByline,
  stockCountLabel,
  tradingStatus,
} from './stock-view';

const closes = (...values: number[]) =>
  values.map((closeCents, index) => ({ date: `2026-09-${String(index + 8).padStart(2, '0')}`, closeCents }));

const item = (symbol: string): StockListItem => ({ symbol, name: symbol, kind: 'company', priceCents: 100, changeBps: 0 });

describe('the line of a month of closes', () => {
  it('runs left to right, with the highest close at the top', () => {
    expect(historyLine(closes(100, 200, 150), 104, 44)).toBe('2,42 52,2 102,22');
  });

  it('is a level line when the price never moved', () => {
    expect(historyLine(closes(100, 100), 104, 44)).toBe('2,22 102,22');
  });

  it('is not drawn from fewer than two closes', () => {
    expect(historyLine([], 104, 44)).toBeNull();
    expect(historyLine(closes(100), 104, 44)).toBeNull();
  });
});

describe('how far it moved', () => {
  it('measures from the first close shown to the last', () => {
    expect(historyChange(closes(20_000, 19_000, 21_000))).toEqual({ since: '2026-09-08', changeBps: 500 });
    expect(historyChange(closes(20_000, 19_000))).toEqual({ since: '2026-09-08', changeBps: -500 });
  });

  it('says nothing without two closes', () => {
    expect(historyChange(closes(20_000))).toBeNull();
  });

  it('names the direction', () => {
    expect([changeTone(12), changeTone(-1), changeTone(0)]).toEqual(['up', 'down', 'flat']);
  });
});

describe('dates in plain words', () => {
  it('shortens an exact day and leaves the exchange wording alone', () => {
    expect(formatStockDay('2026-10-09')).toBe('9 Oct');
    expect(formatStockDay('Oct 8, 2026')).toBe('Oct 8, 2026');
  });

  it('writes a moment on the reader’s own clock', () => {
    expect(formatStockMoment(new Date(2026, 9, 12, 1, 0))).toBe('Mon 12 Oct, 1:00 am');
    expect(formatStockMoment(new Date(2026, 9, 16, 12, 5))).toBe('Fri 16 Oct, 12:05 pm');
    expect(formatStockMoment(new Date(2026, 9, 17, 0, 30))).toBe('Sat 17 Oct, 12:30 am');
  });

  it('says whether it can be traded now and when that changes', () => {
    const opens = new Date(2026, 9, 12, 1, 0).toISOString();
    expect(tradingStatus({ marketOpen: false, marketChangesAt: opens })).toBe('Trading is closed. Opens Mon 12 Oct, 1:00 am.');
    expect(tradingStatus({ marketOpen: true, marketChangesAt: opens })).toBe('Trading is open. Closes Mon 12 Oct, 1:00 am.');
    expect(tradingStatus({ marketOpen: true })).toBe('Trading is open.');
    expect(tradingStatus({ marketOpen: false, marketChangesAt: 'not a date' })).toBe('Trading is closed.');
  });
});

describe('the list as it grows', () => {
  it('adds the next page without showing a stock twice', () => {
    const shown = [item('ONE'), item('TWO')];
    expect(appendStockPage(shown, [item('TWO'), item('THREE')]).map((entry) => entry.symbol)).toEqual(['ONE', 'TWO', 'THREE']);
  });

  it('writes a share of the price without a sign', () => {
    expect(formatPercent(2)).toBe('0.02%');
    expect(formatPercent(150)).toBe('1.50%');
  });

  it('says what each one is under its name', () => {
    expect(stockByline({ symbol: 'ONE', kind: 'company', sector: 'Technology' })).toBe('ONE · Technology');
    expect(stockByline({ symbol: 'TWO', kind: 'fund' })).toBe('TWO · Fund');
    expect(stockByline({ symbol: 'THREE', kind: 'company' })).toBe('THREE');
  });

  it('counts in words', () => {
    expect(stockCountLabel(1048)).toBe('1,048 stocks');
    expect(stockCountLabel(974, 'company')).toBe('974 companies');
    expect(stockCountLabel(1, 'fund')).toBe('1 fund');
  });
});
