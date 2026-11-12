import { z } from 'zod';

import { parseMajorAmount } from './payroll-import';

/**
 * A bank statement, read into lines the money picture can use.
 *
 * The PDF's text is pulled out on the server (`unpdf`), laid back into rows
 * here, and handed in chunks to a model running in sealed hardware on NEAR AI
 * Cloud (see `tee-proof.ts`). The model only reads: it copies each line's
 * date, description and the amounts exactly as printed, and names a kind of
 * spending from a fixed list. It does no arithmetic. The amounts are turned
 * into kobo here, by `parseMajorAmount`, and the statement is then balanced
 * against its own opening and closing figures, so a line the model dropped or
 * misread shows up as a difference rather than as a confident wrong picture.
 */

// ------------------------------------------------------------------ rows

/** One piece of text on a page, as pdf.js reports it (y grows upwards). */
export type TextItem = { str: string; x: number; y: number; width?: number; page: number };

/** Pieces on the same printed line differ in y by less than this. */
const ROW_TOLERANCE = 2.5;
/** A gap wider than this between pieces is a column break. */
const COLUMN_GAP = 12;

/**
 * Lays text back into printed rows: pdf.js returns pieces in drawing order,
 * which for a table often runs down a column instead of across a row.
 */
export function rowsFromItems(items: readonly TextItem[]): string[] {
  const byPage = new Map<number, TextItem[]>();
  for (const item of items) {
    if (!item.str.trim()) continue;
    const list = byPage.get(item.page) ?? [];
    list.push(item);
    byPage.set(item.page, list);
  }
  const rows: string[] = [];
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const pieces = [...byPage.get(page)!].sort((a, b) => b.y - a.y || a.x - b.x);
    let current: TextItem[] = [];
    let rowY = Number.NaN;
    const flush = () => {
      if (!current.length) return;
      current.sort((a, b) => a.x - b.x);
      let text = '';
      let end = Number.NaN;
      for (const piece of current) {
        const gap = Number.isNaN(end) ? 0 : piece.x - end;
        text += text ? (gap > COLUMN_GAP ? ' | ' : ' ') : '';
        text += piece.str.trim();
        end = piece.x + (piece.width ?? piece.str.length * 4.5);
      }
      rows.push(text.replace(/\s+/g, ' ').trim());
      current = [];
    };
    for (const piece of pieces) {
      if (current.length && Math.abs(piece.y - rowY) > ROW_TOLERANCE) flush();
      if (!current.length) rowY = piece.y;
      current.push(piece);
    }
    flush();
  }
  return rows.filter(Boolean);
}

/** Rows split into pieces small enough for one model call each. */
export function chunkRows(rows: readonly string[], maxChars = 5000): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const row of rows) {
    if (current && current.length + row.length + 1 > maxChars) {
      chunks.push(current);
      current = '';
    }
    current += (current ? '\n' : '') + row.slice(0, maxChars);
  }
  if (current) chunks.push(current);
  return chunks;
}

/** A statement's whole text is capped, so a 300-page upload cannot run up the bill. */
export const STATEMENT_MAX_CHUNKS = 24;

// -------------------------------------------------------------- categories

export const SPENDING_KINDS = [
  'income',
  'transfer-in',
  'food',
  'transport',
  'data-airtime',
  'power',
  'rent-home',
  'subscriptions',
  'shopping',
  'family',
  'transfer-out',
  'savings-investing',
  'bank-fees',
  'tax',
  'health',
  'education',
  'entertainment',
  'cash',
  'other',
] as const;
export type SpendingKind = (typeof SPENDING_KINDS)[number];

export const SPENDING_KIND_WORDS: Record<SpendingKind, string> = {
  income: 'Income',
  'transfer-in': 'Money in',
  food: 'Food and eating out',
  transport: 'Transport',
  'data-airtime': 'Data and airtime',
  power: 'Power',
  'rent-home': 'Rent and home',
  subscriptions: 'Subscriptions',
  shopping: 'Shopping',
  family: 'Family and friends',
  'transfer-out': 'Transfers out',
  'savings-investing': 'Savings and investing',
  'bank-fees': 'Bank charges',
  tax: 'Tax and levies',
  health: 'Health',
  education: 'Learning',
  entertainment: 'Fun',
  cash: 'Cash',
  other: 'Other',
};

// ------------------------------------------------------------ the model

export const STATEMENT_SYSTEM_PROMPT = [
  'You read one part of a Nigerian bank statement and copy out its transactions.',
  'Answer with JSON only: {"opening": string|null, "closing": string|null, "lines": [...]}.',
  'Each line is {"date": "YYYY-MM-DD", "description": string, "debit": string, "credit": string, "balance": string, "kind": string, "merchant": string}.',
  'Copy every amount exactly as printed, digits, commas and decimals, with no currency sign. Use "" when a column is empty. Never add, subtract or round.',
  'A line has either a debit (money out) or a credit (money in), never both.',
  '"opening" and "closing" are the opening and closing balances only if this part prints them, else null.',
  `"kind" is one of: ${SPENDING_KINDS.join(', ')}. Salary, invoices and client payments are income. Netflix, Spotify, ChatGPT, Claude, Cursor, Apple, Google, iCloud and other repeating app charges are subscriptions. SMS alerts, stamp duty, maintenance and transfer charges are bank-fees. Electronic money transfer levy is tax.`,
  '"merchant" is the short name of who was paid or who paid, in plain words, without reference numbers, e.g. "Bolt", "MTN", "Ikeja Electric", "Chinedu Okafor". Use "" if none.',
  'Skip headers, page numbers, totals and summary rows. Do not invent lines. If this part has no transactions, answer {"opening": null, "closing": null, "lines": []}.',
].join('\n');

const looseText = z.preprocess((value) => (value === null || value === undefined ? '' : String(value)), z.string());

export const modelLineSchema = z.object({
  date: looseText,
  description: looseText,
  debit: looseText,
  credit: looseText,
  balance: looseText,
  kind: looseText,
  merchant: looseText,
});

export const modelChunkSchema = z.object({
  opening: z.preprocess((value) => (value === undefined ? null : value), looseText.nullable()),
  closing: z.preprocess((value) => (value === undefined ? null : value), looseText.nullable()),
  lines: z.array(modelLineSchema).max(400),
});
export type ModelChunk = z.infer<typeof modelChunkSchema>;

// --------------------------------------------------------------- lines

export const statementLineSchema = z.object({
  /** Day of the transaction, YYYY-MM-DD. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().max(200),
  merchant: z.string().max(80),
  kind: z.enum(SPENDING_KINDS),
  direction: z.enum(['in', 'out']),
  amountMinor: z.number().int().positive(),
  /** The balance printed after this line, when the statement prints one. */
  balanceMinor: z.number().int().optional(),
});
export type StatementLine = z.infer<typeof statementLineSchema>;

/** A printed amount to kobo, or null for empty. Dashes and "0.00" are empty. */
export function printedAmount(text: string): number | null | 'unreadable' {
  const cleaned = text.replace(/[₦]|NGN/gi, '').trim();
  if (!cleaned || /^[-–—]+$/.test(cleaned) || /^0+(?:\.0+)?$/.test(cleaned.replace(/,/g, ''))) return null;
  const parsed = parseMajorAmount(cleaned.replace(/^-/, ''));
  if (!parsed.ok) return 'unreadable';
  return parsed.minor;
}

/** A printed balance; overdrawn balances are printed with a minus or "DR". */
export function printedBalance(text: string): number | undefined {
  const negative = /^-|\(|DR$/i.test(text.trim());
  const amount = printedAmount(text.replace(/[()]|DR$|CR$/gi, ''));
  if (amount === 'unreadable') return undefined;
  if (amount === null) return /\d/.test(text) ? 0 : undefined;
  return negative ? -amount : amount;
}

/** A real calendar day: "2026-11-31" is not one, though `Date.parse` rolls it on to 1 December. */
const isDay = (text: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const at = Date.parse(`${text}T00:00:00Z`);
  return !Number.isNaN(at) && new Date(at).toISOString().slice(0, 10) === text;
};

export type ReadLines = { lines: StatementLine[]; skipped: number };

/** The model's lines, checked and turned into kobo. A line that does not read is counted, not guessed. */
export function toStatementLines(chunk: ModelChunk): ReadLines {
  const lines: StatementLine[] = [];
  let skipped = 0;
  for (const raw of chunk.lines) {
    const debit = printedAmount(raw.debit);
    const credit = printedAmount(raw.credit);
    if (!isDay(raw.date) || debit === 'unreadable' || credit === 'unreadable' || (debit === null) === (credit === null)) {
      skipped += 1;
      continue;
    }
    const direction = debit !== null ? 'out' : 'in';
    const kind = (SPENDING_KINDS as readonly string[]).includes(raw.kind) ? (raw.kind as SpendingKind) : 'other';
    lines.push({
      date: raw.date,
      description: raw.description.trim().slice(0, 200),
      merchant: raw.merchant.trim().slice(0, 80),
      kind,
      direction,
      amountMinor: (debit ?? credit) as number,
      balanceMinor: printedBalance(raw.balance),
    });
  }
  return { lines, skipped };
}

// ---------------------------------------------------------- reconciling

export type Reconciliation = {
  /**
   * - `balanced`: opening + money in − money out = closing, to the kobo.
   * - `off`: it does not; `differenceMinor` says by how much.
   * - `unknown`: the statement's opening or closing figure was not found.
   */
  status: 'balanced' | 'off' | 'unknown';
  openingMinor?: number;
  closingMinor?: number;
  inMinor: number;
  outMinor: number;
  differenceMinor?: number;
  /** Lines whose printed balance does not follow from the line before. */
  runningBreaks: number;
  skipped: number;
};

export function reconcile(input: {
  lines: readonly StatementLine[];
  openingMinor?: number;
  closingMinor?: number;
  skipped: number;
}): Reconciliation {
  const inMinor = input.lines.filter((line) => line.direction === 'in').reduce((sum, line) => sum + line.amountMinor, 0);
  const outMinor = input.lines.filter((line) => line.direction === 'out').reduce((sum, line) => sum + line.amountMinor, 0);

  let runningBreaks = 0;
  let previous: number | undefined = input.openingMinor;
  for (const line of input.lines) {
    if (line.balanceMinor === undefined) {
      previous = undefined;
      continue;
    }
    if (previous !== undefined) {
      const expected = previous + (line.direction === 'in' ? line.amountMinor : -line.amountMinor);
      if (expected !== line.balanceMinor) runningBreaks += 1;
    }
    previous = line.balanceMinor;
  }

  const base = { inMinor, outMinor, runningBreaks, skipped: input.skipped, openingMinor: input.openingMinor, closingMinor: input.closingMinor };
  if (input.openingMinor === undefined || input.closingMinor === undefined) return { ...base, status: 'unknown' };
  const differenceMinor = input.openingMinor + inMinor - outMinor - input.closingMinor;
  return { ...base, status: differenceMinor === 0 ? 'balanced' : 'off', differenceMinor };
}

/**
 * Joins what each chunk read into one statement: lines in order, the first
 * opening balance and the last closing balance found. When the statement
 * prints no opening figure, the first line's balance minus its own amount is
 * the opening it implies.
 */
export function joinChunks(chunks: readonly ModelChunk[]): { lines: StatementLine[]; openingMinor?: number; closingMinor?: number; skipped: number } {
  const lines: StatementLine[] = [];
  let skipped = 0;
  let openingMinor: number | undefined;
  let closingMinor: number | undefined;
  for (const chunk of chunks) {
    const read = toStatementLines(chunk);
    lines.push(...read.lines);
    skipped += read.skipped;
    if (openingMinor === undefined && chunk.opening) openingMinor = printedBalance(chunk.opening);
    if (chunk.closing) closingMinor = printedBalance(chunk.closing) ?? closingMinor;
  }
  const first = lines[0];
  if (openingMinor === undefined && first?.balanceMinor !== undefined) {
    openingMinor = first.balanceMinor + (first.direction === 'in' ? -first.amountMinor : first.amountMinor);
  }
  const last = lines.at(-1);
  if (closingMinor === undefined && last?.balanceMinor !== undefined) closingMinor = last.balanceMinor;
  return { lines, openingMinor, closingMinor, skipped };
}

// ------------------------------------------------------------- storing

/** What is kept on the device (sealed in the person's records), newest six months. */
export const KEEP_STATEMENT_DAYS = 186;

export const storedStatementSchema = z.object({
  importedAt: z.string(),
  from: z.string(),
  to: z.string(),
  lines: z.array(statementLineSchema),
  reconciliation: z.object({
    status: z.enum(['balanced', 'off', 'unknown']),
    differenceMinor: z.number().int().optional(),
    closingMinor: z.number().int().optional(),
  }),
  proven: z.boolean(),
});
export type StoredStatement = z.infer<typeof storedStatementSchema>;

/** Merges a new statement into what is kept: same day + description + amount is one line. */
export function mergeStatements(kept: readonly StatementLine[], incoming: readonly StatementLine[], today: string): StatementLine[] {
  const key = (line: StatementLine) => `${line.date}|${line.direction}|${line.amountMinor}|${line.description.toLowerCase()}`;
  const seen = new Map<string, number>();
  const out: StatementLine[] = [];
  // Identical lines inside one statement are real (two ₦1,000 airtime top-ups on one day);
  // only lines repeated across statements are dropped, by counting per source.
  const keptCounts = new Map<string, number>();
  for (const line of kept) keptCounts.set(key(line), (keptCounts.get(key(line)) ?? 0) + 1);
  for (const line of incoming) {
    const k = key(line);
    const used = seen.get(k) ?? 0;
    seen.set(k, used + 1);
    if (used < (keptCounts.get(k) ?? 0)) continue;
    out.push(line);
  }
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - KEEP_STATEMENT_DAYS * 86_400_000).toISOString().slice(0, 10);
  return [...kept, ...out].filter((line) => line.date >= cutoff).sort((a, b) => a.date.localeCompare(b.date));
}
