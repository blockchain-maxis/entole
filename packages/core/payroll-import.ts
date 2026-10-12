import { read, utils } from 'xlsx';

import { formatHandle, type Handle, type HandleDirectory } from './handle';
import { findRecipient, readRecipient } from './recipient';

/**
 * Reading a payroll spreadsheet into rows the app can pay.
 *
 * Platform-free on purpose: every function takes a string or bytes, so the phone
 * (document picker), the web (file input) and the tests all go through the same
 * door. Nothing here guesses. A row that isn't clearly a person, a username or
 * phone number and a positive amount is left out and reported in `problems` in
 * plain words, with the row number as it appears in the spreadsheet.
 *
 * Reading the file is one step and needs no network. Finding out who each
 * username or number belongs to is a second one (`resolvePayrollImport`),
 * because only the directory knows.
 *
 * Amounts are written in major units the way people write them ("150,000",
 * "₦150,000.50") and parsed to integer kobo with exact decimal-string
 * arithmetic — a float never touches the money.
 */

export type PayrollRow = {
  /** The row as numbered in the spreadsheet (1 is the first row, the header included). */
  line: number;
  name: string;
  /** Their account, in the form records keep it. Never put on a screen. */
  code: string;
  /** The username or number in the file, as a person writes it. */
  handle?: string;
  amountMinor: number;
  note?: string;
};

/** A row read from the file whose username or number has not been looked up yet. */
export type PendingPayrollRow = Omit<PayrollRow, 'code' | 'handle'> & { handle: Handle };

export type PayrollProblem = {
  line: number;
  /** Plain words for the person reading the review list. */
  message: string;
  /** An `error` left the row out. A `warning` did not stop anything but is worth a look. */
  kind: 'error' | 'warning';
};

export type PayrollImport = {
  /** People who can be paid: found in the directory. */
  rows: PayrollRow[];
  /** People still to be looked up. Empty once `resolvePayrollImport` has run. */
  pending: PendingPayrollRow[];
  problems: PayrollProblem[];
};

/** More people than this in one file is almost certainly the wrong file. */
export const MAX_PAYROLL_ROWS = 500;

/** How many people are looked up in the directory at the same time. */
const LOOKUPS_AT_ONCE = 8;

/** How far down to look for the row of column headings, past any title rows. */
const HEADER_SEARCH_ROWS = 10;

// ---------------------------------------------------------------- amounts

const MAX_SAFE_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

export type AmountParse =
  | { ok: true; minor: number }
  | { ok: false; reason: 'empty' | 'invalid' | 'decimals' | 'not-positive' };

/**
 * A pay amount as people write it, in major units, to integer minor units.
 * "150,000" → 15_000_000. Accepts a leading ₦, N or NGN and comma or space
 * thousands separators. More than two decimals (that aren't zeros) is refused
 * rather than rounded: a payroll that quietly changes an amount is worse than
 * one that stops.
 */
export function parseMajorAmount(input: string): AmountParse {
  let text = input.replace(/[\u00a0\u2007\u202f]/g, ' ').trim();
  if (!text) return { ok: false, reason: 'empty' };

  text = text.replace(/^(?:₦|NGN|N)\s*/i, '').replace(/\s*(?:NGN|naira)$/i, '').trim();
  if (text.startsWith('-') || text.startsWith('(')) return { ok: false, reason: 'not-positive' };
  text = text.replace(/^\+/, '');

  const grouped = /^\d{1,3}(?:[, ]\d{3})+(?:\.\d+)?$/;
  const plain = /^(?:\d+(?:\.\d+)?|\.\d+)$/;
  if (!grouped.test(text) && !plain.test(text)) return { ok: false, reason: 'invalid' };

  const [wholeRaw = '', fractionRaw = ''] = text.replace(/[, ]/g, '').split('.');
  const fraction = fractionRaw.replace(/0+$/, '');
  if (fraction.length > 2) return { ok: false, reason: 'decimals' };

  const minor = BigInt(wholeRaw || '0') * 100n + BigInt(fraction.padEnd(2, '0'));
  if (minor <= 0n) return { ok: false, reason: 'not-positive' };
  if (minor > MAX_SAFE_MINOR) return { ok: false, reason: 'invalid' };
  return { ok: true, minor: Number(minor) };
}

// -------------------------------------------------------------------- CSV

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Picks the separator a spreadsheet program used: comma, semicolon or tab. */
function detectDelimiter(text: string): string {
  const first = text.split(/\r\n|\n|\r/).find((line) => line.trim().length > 0) ?? '';
  let best = ',';
  let bestCount = 0;
  for (const candidate of [',', ';', '\t']) {
    let inQuotes = false;
    let count = 0;
    for (const char of first) {
      if (char === '"') inQuotes = !inQuotes;
      else if (char === candidate && !inQuotes) count += 1;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** Quoted fields, doubled quotes, commas inside quotes and line breaks inside quotes. */
export function parseCsv(input: string): string[][] {
  const text = stripBom(input);
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"' && field.length === 0) {
      inQuotes = true;
    } else if (char === delimiter) {
      endField();
    } else if (char === '\r') {
      if (text[index + 1] === '\n') index += 1;
      endRow();
    } else if (char === '\n') {
      endRow();
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) endRow();
  return rows;
}

// ---------------------------------------------------------------- headers

type Field = 'name' | 'code' | 'amount' | 'note';

/** Checked in this order, so "Username or number" names who is paid before
 * "number" or "pay" could be anything else. The older headings are still read. */
const SYNONYMS: [Field, string[]][] = [
  [
    'code',
    [
      'username or number',
      'entole username',
      'username',
      'user name',
      'handle',
      'phone number',
      'mobile number',
      'phone',
      'mobile',
      'payment code',
      'pay code',
      'entole code',
      'code',
      'checkout link',
      'payment link',
      'pay link',
      'link',
    ],
  ],
  ['amount', ['net pay', 'net salary', 'salary', 'wage', 'wages', 'amount', 'pay']],
  ['note', ['narration', 'reference', 'ref', 'memo', 'note', 'notes', 'description', 'remark', 'remarks']],
  ['name', ['staff name', 'employee name', 'full name', 'name', 'staff', 'employee', 'worker', 'payee', 'beneficiary']],
];

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function containsRun(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    if (needle.every((word, offset) => haystack[start + offset] === word)) return true;
  }
  return false;
}

function fieldFor(header: string): Field | null {
  const words = tokens(header);
  if (words.length === 0) return null;
  for (const [field, synonyms] of SYNONYMS) {
    if (synonyms.some((synonym) => containsRun(words, synonym.split(' ')))) return field;
  }
  return null;
}

type Columns = Partial<Record<Field, number>>;

function mapColumns(cells: string[]): Columns {
  const columns: Columns = {};
  cells.forEach((cell, index) => {
    const field = fieldFor(cell);
    if (field && columns[field] === undefined) columns[field] = index;
  });
  return columns;
}

const FIELD_WORDS: Record<Field, string> = {
  name: 'Name',
  code: 'Username or number',
  amount: 'Amount',
  note: 'Note',
};

const isBlankRow = (cells: string[]) => cells.every((cell) => cell.trim() === '');

// -------------------------------------------------------------------- rows

/**
 * Turns a grid of cells (already read from CSV or a sheet) into payroll rows.
 * `firstLine` is the spreadsheet row number of `grid[0]`.
 */
export function parsePayrollGrid(grid: string[][], firstLine = 1): PayrollImport {
  const problems: PayrollProblem[] = [];
  const rows: PayrollRow[] = [];

  if (grid.every(isBlankRow)) {
    return {
      rows,
      pending: [],
      problems: [{ line: firstLine, kind: 'error', message: 'That file has no rows in it.' }],
    };
  }

  let headerIndex = -1;
  let columns: Columns = {};
  for (let index = 0; index < Math.min(grid.length, HEADER_SEARCH_ROWS); index += 1) {
    const cells = grid[index]!;
    if (isBlankRow(cells)) continue;
    const candidate = mapColumns(cells);
    if (Object.keys(candidate).length >= 2) {
      headerIndex = index;
      columns = candidate;
      break;
    }
  }

  if (headerIndex < 0) {
    return {
      rows,
      pending: [],
      problems: [
        {
          line: firstLine,
          kind: 'error',
          message: "We couldn't find the column headings. Start with Name, Username or number and Amount.",
        },
      ],
    };
  }

  const headerLine = firstLine + headerIndex;
  const missing = (['name', 'code', 'amount'] as const).filter((field) => columns[field] === undefined);
  if (missing.length > 0) {
    return {
      rows,
      pending: [],
      problems: [
        {
          line: headerLine,
          kind: 'error',
          message: `Row ${headerLine}: there is no ${missing.map((field) => `“${FIELD_WORDS[field]}”`).join(' or ')} column.`,
        },
      ],
    };
  }

  const cell = (cells: string[], field: Field) => (cells[columns[field]!] ?? '').trim();
  const pending: PendingPayrollRow[] = [];
  const seen = new Map<string, { name: string; line: number }>();

  for (let index = headerIndex + 1; index < grid.length; index += 1) {
    const cells = grid[index]!;
    if (isBlankRow(cells)) continue;
    const line = firstLine + index;
    const fail = (message: string) => problems.push({ line, kind: 'error', message: `Row ${line}: ${message}` });

    if (rows.length + pending.length >= MAX_PAYROLL_ROWS) {
      problems.push({
        line,
        kind: 'error',
        message: `Row ${line}: only the first ${MAX_PAYROLL_ROWS} people are read from one file.`,
      });
      break;
    }

    const name = cell(cells, 'name');
    if (!name) {
      fail('add a name.');
      continue;
    }

    const who = cell(cells, 'code');
    if (!who) {
      fail('add a username or phone number.');
      continue;
    }
    const sought = readRecipient(who);
    if (!sought) {
      fail("that doesn't look like a username or a phone number.");
      continue;
    }
    // One person, however the file writes them.
    const key = sought.kind === 'known' ? sought.checkout.code : formatHandle(sought.handle);

    const amount = parseMajorAmount(cell(cells, 'amount'));
    if (!amount.ok) {
      fail(
        amount.reason === 'empty'
          ? 'add an amount.'
          : amount.reason === 'decimals'
            ? 'amounts can have at most 2 decimal places.'
            : amount.reason === 'not-positive'
              ? 'the amount has to be more than zero.'
              : "that amount doesn't look right.",
      );
      continue;
    }

    const earlier = seen.get(key);
    if (earlier) {
      problems.push({
        line,
        kind: 'warning',
        message: `Row ${line}: ${name} is the same person as ${earlier.name} on row ${earlier.line}, so this row was left out.`,
      });
      continue;
    }

    const note = cell(cells, 'note');
    const row = { line, name, amountMinor: amount.minor, ...(note ? { note } : {}) };
    seen.set(key, row);
    if (sought.kind === 'known') rows.push({ ...row, code: sought.checkout.code });
    else pending.push({ ...row, handle: sought.handle });
  }

  if (rows.length === 0 && pending.length === 0 && problems.length === 0) {
    problems.push({ line: headerLine, kind: 'error', message: 'There are no people under the headings yet.' });
  }

  return { rows, pending, problems };
}

/**
 * Asks the directory who each username or number in the file belongs to. Someone
 * it has becomes a row that can be paid; someone it does not have is a problem
 * on their row, in plain words. Two rows that turn out to be one person (their
 * username on one, their number on another) keep the first.
 */
export async function resolvePayrollImport(
  result: PayrollImport,
  directory: HandleDirectory,
): Promise<PayrollImport> {
  if (result.pending.length === 0) return result;

  // A few at a time: a long payroll should not open hundreds of requests at once.
  const looked: { row: PendingPayrollRow; found: Awaited<ReturnType<typeof findRecipient>> }[] = [];
  for (let start = 0; start < result.pending.length; start += LOOKUPS_AT_ONCE) {
    const batch = result.pending.slice(start, start + LOOKUPS_AT_ONCE);
    looked.push(
      ...(await Promise.all(
        batch.map(async (row) => ({
          row,
          found: await findRecipient(directory, { kind: 'handle', handle: row.handle, request: null }).catch(
            () => null,
          ),
        })),
      )),
    );
  }

  const problems = [...result.problems];
  const candidates: PayrollRow[] = [...result.rows];
  for (const { row, found } of looked) {
    const written = formatHandle(row.handle);
    if (!found) {
      problems.push({
        line: row.line,
        kind: 'error',
        message: `Row ${row.line}: we couldn't find ${written} on Entole.`,
      });
      continue;
    }
    const { handle: _handle, ...rest } = row;
    candidates.push({ ...rest, code: found.code, handle: written });
  }

  candidates.sort((a, b) => a.line - b.line);
  const rows: PayrollRow[] = [];
  const byCode = new Map<string, PayrollRow>();
  for (const row of candidates) {
    const earlier = byCode.get(row.code);
    if (earlier) {
      problems.push({
        line: row.line,
        kind: 'warning',
        message: `Row ${row.line}: ${row.name} is the same person as ${earlier.name} on row ${earlier.line}, so this row was left out.`,
      });
      continue;
    }
    byCode.set(row.code, row);
    rows.push(row);
  }

  problems.sort((a, b) => a.line - b.line);
  return { rows, pending: [], problems };
}

/** A payroll from CSV text. */
export function parsePayrollCsv(text: string): PayrollImport {
  return parsePayrollGrid(parseCsv(text));
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    // A number typed into a cell. Formulas leave float noise (0.1 + 0.2), so
    // anything within a hair of a whole kobo is read as that kobo; anything
    // else keeps its real digits and is refused as "too many decimals".
    const scaled = value * 100;
    return Math.abs(scaled - Math.round(scaled)) < 1e-6 ? value.toFixed(2) : String(value);
  }
  return String(value);
}

/** A payroll from the bytes of an .xlsx or .xls file — the first sheet only. */
export function parsePayrollSheet(bytes: Uint8Array): PayrollImport {
  try {
    const workbook = read(bytes, { type: 'array' });
    const name = workbook.SheetNames[0];
    const sheet = name ? workbook.Sheets[name] : undefined;
    if (!sheet) {
      return {
        rows: [],
        pending: [],
        problems: [{ line: 1, kind: 'error', message: 'That file has no sheets in it.' }],
      };
    }
    const grid = utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '', blankrows: true });
    const firstLine = sheet['!ref'] ? utils.decode_range(sheet['!ref']).s.r + 1 : 1;
    return parsePayrollGrid(
      grid.map((row) => row.map(cellText)),
      firstLine,
    );
  } catch {
    return { rows: [], pending: [], problems: [UNREADABLE] };
  }
}

const UNREADABLE: PayrollProblem = {
  line: 1,
  kind: 'error',
  message: "We couldn't read that file. Use a spreadsheet saved as .xlsx, .xls or .csv.",
};

/** A zipped workbook (.xlsx) starts "PK"; an old one (.xls) starts with the OLE header. */
function looksLikeWorkbook(bytes: Uint8Array): boolean {
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const ole = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  return zip || ole;
}

/** Whatever the picker handed over: Excel bytes go to the sheet reader, anything else is read as CSV text. */
export function parsePayrollBytes(bytes: Uint8Array): PayrollImport {
  if (bytes.length === 0) {
    return { rows: [], pending: [], problems: [{ line: 1, kind: 'error', message: 'That file is empty.' }] };
  }
  if (looksLikeWorkbook(bytes)) return parsePayrollSheet(bytes);
  try {
    return parsePayrollCsv(new TextDecoder('utf-8').decode(bytes));
  } catch {
    return { rows: [], pending: [], problems: [UNREADABLE] };
  }
}

/**
 * A sample file to fill in. The middle column holds an obvious placeholder,
 * never a real-looking username: importing it untouched has to fail, not pay a
 * stranger.
 */
export function payrollTemplateCsv(): string {
  return [
    'Name,Username or number,Amount,Note',
    'Ada Okafor,her username or phone number,"150,000",September salary',
    'Tunde Bello,his username or phone number,"95,500.50",September salary',
    '',
  ].join('\n');
}
