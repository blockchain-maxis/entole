import { describe, expect, it } from 'vitest';

import {
  chunkRows,
  joinChunks,
  mergeStatements,
  modelChunkSchema,
  printedAmount,
  printedBalance,
  reconcile,
  rowsFromItems,
  toStatementLines,
  type StatementLine,
  type TextItem,
} from './statement';

describe('laying text back into rows', () => {
  it('reads a table across, not down its columns', () => {
    // pdf.js often hands a table over column by column.
    const items: TextItem[] = [
      { str: '01-Nov-2026', x: 40, y: 700, page: 1, width: 50 },
      { str: '02-Nov-2026', x: 40, y: 685, page: 1, width: 50 },
      { str: 'POS BOLT', x: 120, y: 700.8, page: 1, width: 40 },
      { str: 'NIP/MTN DATA', x: 120, y: 685.4, page: 1, width: 60 },
      { str: '2,500.00', x: 300, y: 700, page: 1, width: 40 },
      { str: '1,000.00', x: 300, y: 685, page: 1, width: 40 },
      { str: 'Page 2 line', x: 40, y: 700, page: 2, width: 40 },
    ];
    expect(rowsFromItems(items)).toEqual([
      '01-Nov-2026 | POS BOLT | 2,500.00',
      '02-Nov-2026 | NIP/MTN DATA | 1,000.00',
      'Page 2 line',
    ]);
  });

  it('chunks rows without splitting one', () => {
    const rows = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)];
    expect(chunkRows(rows, 90)).toEqual([`${rows[0]}\n${rows[1]}`, rows[2]]);
  });
});

describe('printed amounts', () => {
  it('reads amounts exactly, in kobo', () => {
    expect(printedAmount('15,000.00')).toBe(1_500_000);
    expect(printedAmount('₦ 2,500.5')).toBe(250_050);
    expect(printedAmount('')).toBeNull();
    expect(printedAmount('-')).toBeNull();
    expect(printedAmount('0.00')).toBeNull();
    expect(printedAmount('1,23x')).toBe('unreadable');
    expect(printedAmount('10.005')).toBe('unreadable');
  });

  it('keeps an overdrawn balance negative', () => {
    expect(printedBalance('1,000.00')).toBe(100_000);
    expect(printedBalance('-1,000.00')).toBe(-100_000);
    expect(printedBalance('1,000.00 DR')).toBe(-100_000);
    expect(printedBalance('0.00')).toBe(0);
    expect(printedBalance('')).toBeUndefined();
  });
});

const chunk = (lines: object[], opening: string | null = null, closing: string | null = null) =>
  modelChunkSchema.parse({ opening, closing, lines });

describe('the model\'s lines', () => {
  it('keeps lines with one amount and a real day, and counts the rest', () => {
    const read = toStatementLines(chunk([
      { date: '2026-11-01', description: 'POS BOLT 123', debit: '2,500.00', credit: '', balance: '97,500.00', kind: 'transport', merchant: 'Bolt' },
      { date: '2026-11-02', description: 'SALARY', debit: '', credit: '500,000.00', balance: '597,500.00', kind: 'income', merchant: 'Acme' },
      { date: '2026-11-31', description: 'bad day', debit: '1.00', credit: '', balance: '', kind: 'other', merchant: '' },
      { date: '2026-11-03', description: 'both', debit: '1.00', credit: '1.00', balance: '', kind: 'other', merchant: '' },
      { date: '2026-11-03', description: 'weird kind', debit: '100.00', credit: '', balance: '', kind: 'crypto', merchant: '' },
    ]));
    expect(read.skipped).toBe(2);
    expect(read.lines.map((line) => [line.direction, line.amountMinor, line.kind])).toEqual([
      ['out', 250_000, 'transport'],
      ['in', 50_000_000, 'income'],
      ['out', 10_000, 'other'],
    ]);
  });

  it('accepts nulls and numbers from the model as text', () => {
    const parsed = modelChunkSchema.parse({ lines: [{ date: '2026-11-01', description: null, debit: 2500, credit: null, balance: null, kind: 'food', merchant: null }] });
    expect(toStatementLines(parsed).lines[0]?.amountMinor).toBe(250_000);
  });
});

describe('balancing the statement', () => {
  const lines: StatementLine[] = [
    { date: '2026-11-01', description: 'a', merchant: '', kind: 'transport', direction: 'out', amountMinor: 250_000, balanceMinor: 9_750_000 },
    { date: '2026-11-02', description: 'b', merchant: '', kind: 'income', direction: 'in', amountMinor: 50_000_000, balanceMinor: 59_750_000 },
  ];

  it('is balanced when opening + in − out is the closing figure', () => {
    const result = reconcile({ lines, openingMinor: 10_000_000, closingMinor: 59_750_000, skipped: 0 });
    expect(result).toMatchObject({ status: 'balanced', differenceMinor: 0, runningBreaks: 0 });
  });

  it('says by how much when a line is missing', () => {
    const result = reconcile({ lines: lines.slice(1), openingMinor: 10_000_000, closingMinor: 59_750_000, skipped: 0 });
    expect(result.status).toBe('off');
    expect(result.differenceMinor).toBe(250_000);
    expect(result.runningBreaks).toBe(1);
  });

  it('is unknown without the statement\'s own figures', () => {
    expect(reconcile({ lines, skipped: 0 }).status).toBe('unknown');
  });

  it('infers the opening from the first line when it is not printed', () => {
    const joined = joinChunks([
      chunk([{ date: '2026-11-01', description: 'a', debit: '2,500.00', credit: '', balance: '97,500.00', kind: 'transport', merchant: '' }]),
      chunk([{ date: '2026-11-02', description: 'b', debit: '', credit: '1,000.00', balance: '98,500.00', kind: 'income', merchant: '' }], null, '98,500.00'),
    ]);
    expect(joined.openingMinor).toBe(10_000_000);
    expect(reconcile(joined).status).toBe('balanced');
  });
});

describe('keeping statements', () => {
  const line = (date: string, amountMinor: number): StatementLine => ({
    date, description: 'airtime', merchant: 'MTN', kind: 'data-airtime', direction: 'out', amountMinor,
  });

  it('drops lines already kept, keeps genuine repeats, and forgets after six months', () => {
    const kept = [line('2026-10-01', 100_000), line('2026-10-01', 100_000), line('2026-03-01', 5)];
    const incoming = [line('2026-10-01', 100_000), line('2026-10-01', 100_000), line('2026-10-01', 100_000), line('2026-11-01', 200)];
    const merged = mergeStatements(kept, incoming, '2026-11-12');
    expect(merged.filter((l) => l.date === '2026-10-01')).toHaveLength(3);
    expect(merged.some((l) => l.date === '2026-03-01')).toBe(false);
    expect(merged.at(-1)?.date).toBe('2026-11-01');
  });
});
