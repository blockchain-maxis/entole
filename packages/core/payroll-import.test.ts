import { describe, expect, it } from 'vitest';
import { utils, write } from 'xlsx';

import { buildCheckoutLink } from './checkout-link';
import { encodePaymentCode } from './payment-code';
import {
  parseCsv,
  parseMajorAmount,
  parsePayrollBytes,
  parsePayrollCsv,
  parsePayrollSheet,
  payrollTemplateCsv,
} from './payroll-import';

const ADA = encodePaymentCode('0x26dfd3aa7601B57d8b7BB9e9555f5Bdac60dAB01');
const TUNDE = encodePaymentCode('0xc0d9BC33696d2F5676A1AcB1e39d03046405eE80');
const CHIDI = encodePaymentCode('0x1111111111111111111111111111111111111111');

const errors = (result: ReturnType<typeof parsePayrollCsv>) => result.problems.filter((p) => p.kind === 'error');

describe('parseMajorAmount', () => {
  it.each([
    ['150,000', 15_000_000],
    ['150000', 15_000_000],
    ['150000.50', 15_000_050],
    ['₦150,000', 15_000_000],
    ['₦ 150,000.5', 15_000_050],
    ['N150,000', 15_000_000],
    ['NGN 95,500.50', 9_550_050],
    ['150,000 NGN', 15_000_000],
    ['1 250 000', 125_000_000],
    ['0.01', 1],
    ['.5', 50],
    ['150.500', 15_050],
    ['  75000  ', 7_500_000],
  ])('reads %s exactly', (text, minor) => {
    expect(parseMajorAmount(text)).toEqual({ ok: true, minor });
  });

  it('never rounds: more than two real decimals is refused', () => {
    expect(parseMajorAmount('100.005')).toEqual({ ok: false, reason: 'decimals' });
    expect(parseMajorAmount('0.001')).toEqual({ ok: false, reason: 'decimals' });
  });

  it('is exact where a float would not be', () => {
    // 0.1 + 0.2 style values, and numbers past what a float keeps exactly.
    expect(parseMajorAmount('1234567890123.45')).toEqual({ ok: true, minor: 123_456_789_012_345 });
    expect(parseMajorAmount('19.99')).toEqual({ ok: true, minor: 1_999 });
    expect(parseMajorAmount('9999999999999999999')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('refuses what is not a positive amount', () => {
    expect(parseMajorAmount('')).toEqual({ ok: false, reason: 'empty' });
    expect(parseMajorAmount('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(parseMajorAmount('0')).toEqual({ ok: false, reason: 'not-positive' });
    expect(parseMajorAmount('0.00')).toEqual({ ok: false, reason: 'not-positive' });
    expect(parseMajorAmount('-500')).toEqual({ ok: false, reason: 'not-positive' });
    expect(parseMajorAmount('(500)')).toEqual({ ok: false, reason: 'not-positive' });
    for (const bad of ['abc', '12,34', '1,2,3', '150.000,50', '12e3', '$150', '1.2.3']) {
      expect(parseMajorAmount(bad)).toEqual({ ok: false, reason: 'invalid' });
    }
  });
});

describe('parseCsv', () => {
  it('keeps commas, quotes and line breaks inside quoted fields', () => {
    expect(parseCsv('a,"b, c","say ""hi""","line\nbreak"\n1,2,3,4')).toEqual([
      ['a', 'b, c', 'say "hi"', 'line\nbreak'],
      ['1', '2', '3', '4'],
    ]);
  });

  it('reads Windows, old Mac and Unix line endings alike', () => {
    for (const eol of ['\r\n', '\r', '\n']) {
      expect(parseCsv(`a,b${eol}c,d${eol}`)).toEqual([
        ['a', 'b'],
        ['c', 'd'],
      ]);
    }
  });

  it('follows the separator the spreadsheet used', () => {
    expect(parseCsv('a;b;c\n1;2;3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('drops a byte-order mark', () => {
    expect(parseCsv('﻿Name,Amount\nA,1')[0]).toEqual(['Name', 'Amount']);
  });
});

describe('payroll from CSV', () => {
  it('reads a clean file into rows with their spreadsheet row numbers', () => {
    const result = parsePayrollCsv(
      `Name,Payment code,Amount,Note\nAda Okafor,${ADA},"150,000",September\nTunde Bello,${TUNDE},95500.50,\n`,
    );
    expect(result.problems).toEqual([]);
    expect(result.rows).toEqual([
      { line: 2, name: 'Ada Okafor', code: ADA, amountMinor: 15_000_000, note: 'September' },
      { line: 3, name: 'Tunde Bello', code: TUNDE, amountMinor: 9_550_050 },
    ]);
  });

  it('finds messy headers in any order, case and wording', () => {
    const result = parsePayrollCsv(
      `NET PAY (₦) , Employee Name,  narration ,Payment Link\n"₦150,000",Ada,Sept,${ADA}\n`,
    );
    expect(result.problems).toEqual([]);
    expect(result.rows).toEqual([{ line: 2, name: 'Ada', code: ADA, amountMinor: 15_000_000, note: 'Sept' }]);
  });

  it.each([
    ['Staff', 'Code', 'Salary', 'Memo'],
    ['worker', 'pay code', 'wage', 'reference'],
    ['Full Name', 'Checkout Link', 'Amount NGN', 'Description'],
  ])('knows %s / %s / %s / %s', (nameHead, codeHead, amountHead, noteHead) => {
    const result = parsePayrollCsv(`${nameHead},${codeHead},${amountHead},${noteHead}\nAda,${ADA},5000,hi`);
    expect(result.problems).toEqual([]);
    expect(result.rows).toEqual([{ line: 2, name: 'Ada', code: ADA, amountMinor: 500_000, note: 'hi' }]);
  });

  it('reads a checkout link in the code column and keeps only the code', () => {
    const link = buildCheckoutLink('https://entole.vercel.app', { code: ADA, kind: 'pay', amountMinor: 1_00, currency: 'NGN' })!;
    const result = parsePayrollCsv(`name,link,amount\nAda,${link},5000`);
    expect(result.rows[0]).toMatchObject({ code: ADA, amountMinor: 500_000 });
    // The amount in the link is the payee's ask, never the payroll's.
    expect(result.rows[0]!.amountMinor).not.toBe(100);
  });

  it('accepts a lowercase or retyped code and normalises it', () => {
    const result = parsePayrollCsv(`name,code,amount\nAda,${ADA.toLowerCase()},100`);
    expect(result.rows[0]!.code).toBe(ADA);
  });

  it('skips blank lines and title rows above the headings, and numbers rows as the sheet does', () => {
    const result = parsePayrollCsv(
      `Payroll September\n\nName,Code,Amount\n\nAda,${ADA},100\n,,\nTunde,${TUNDE},200\n`,
    );
    expect(result.problems).toEqual([]);
    expect(result.rows.map((row) => [row.line, row.name])).toEqual([
      [5, 'Ada'],
      [7, 'Tunde'],
    ]);
  });

  it('survives a byte-order mark and quoted commas in a name', () => {
    const result = parsePayrollCsv(`﻿Name,Payment code,Amount\n"Okafor, Ada",${ADA},"1,500.25"\n`);
    expect(result.problems).toEqual([]);
    expect(result.rows).toEqual([{ line: 2, name: 'Okafor, Ada', code: ADA, amountMinor: 150_025 }]);
  });

  it('says exactly which row has which problem, in plain words, and keeps the good rows', () => {
    const result = parsePayrollCsv(
      [
        'Name,Payment code,Amount',
        `Ada,${ADA},100`,
        `Tunde,PAY-NOPE,100`,
        `,${CHIDI},100`,
        `Chidi,${CHIDI},`,
        `Emeka,${CHIDI},abc`,
        `Ife,${CHIDI},0`,
        `Kemi,${CHIDI},10.999`,
        `Zainab,,100`,
        `Yusuf,${TUNDE},100`,
      ].join('\n'),
    );
    expect(result.rows.map((row) => row.name)).toEqual(['Ada', 'Yusuf']);
    expect(result.problems.map((p) => p.message)).toEqual([
      "Row 3: that code doesn't look right.",
      'Row 4: add a name.',
      'Row 5: add an amount.',
      "Row 6: that amount doesn't look right.",
      'Row 7: the amount has to be more than zero.',
      'Row 8: amounts can have at most 2 decimal places.',
      'Row 9: add a payment code.',
    ]);
    expect(result.problems.every((p) => p.kind === 'error')).toBe(true);
    expect(result.problems.map((p) => p.line)).toEqual([3, 4, 5, 6, 7, 8, 9]);
  });

  it('warns about a repeated code and leaves the repeat out', () => {
    const result = parsePayrollCsv(`Name,Code,Amount\nAda,${ADA},100\nAda O.,${ADA},100\nTunde,${TUNDE},50`);
    expect(result.rows.map((row) => row.name)).toEqual(['Ada', 'Tunde']);
    expect(result.problems).toEqual([
      {
        line: 3,
        kind: 'warning',
        message: 'Row 3: Ada O. has the same payment code as Ada on row 2, so this row was left out.',
      },
    ]);
    expect(errors(result)).toEqual([]);
  });

  it('treats an empty or heading-only file as a message, never a crash', () => {
    expect(parsePayrollCsv('').problems[0]!.message).toBe('That file has no rows in it.');
    expect(parsePayrollCsv('\n\n  \n').rows).toEqual([]);
    expect(parsePayrollCsv('Name,Code,Amount\n').problems[0]!.message).toBe(
      'There are no people under the headings yet.',
    );
  });

  it('says so when the headings are missing or incomplete', () => {
    expect(parsePayrollCsv(`Ada,${ADA},100`).problems[0]!.message).toMatch(/couldn't find the column headings/);
    expect(parsePayrollCsv('Name,Amount\nAda,100').problems[0]!.message).toBe(
      'Row 1: there is no “Payment code” column.',
    );
  });

  it('never returns a row it could not fully trust', () => {
    const result = parsePayrollCsv(`Name,Code,Amount\nAda,${ADA},1e3\nBo,${TUNDE},$5`);
    expect(result.rows).toEqual([]);
    expect(result.problems).toHaveLength(2);
  });

  it('the sample file is honest: importing it untouched pays nobody', () => {
    const csv = payrollTemplateCsv();
    expect(csv.split('\n')[0]).toBe('Name,Payment code,Amount,Note');
    const result = parsePayrollCsv(csv);
    expect(result.rows).toEqual([]);
    expect(errors(result).length).toBe(2);
    expect(result.problems[0]!.message).toBe("Row 2: that code doesn't look right.");
  });
});

function workbookBytes(grid: unknown[][], type: 'xlsx' | 'xls' = 'xlsx'): Uint8Array {
  const book = utils.book_new();
  utils.book_append_sheet(book, utils.aoa_to_sheet(grid), 'Payroll');
  return new Uint8Array(write(book, { type: 'array', bookType: type }) as ArrayBuffer);
}

describe('payroll from Excel', () => {
  it('reads the first sheet of an .xlsx built in place', () => {
    const bytes = workbookBytes([
      ['Staff', 'Payment code', 'Salary', 'Narration'],
      ['Ada Okafor', ADA, 150000, 'September'],
      ['Tunde Bello', TUNDE, '₦95,500.50', ''],
      [],
      ['Chidi', CHIDI, 20000.5],
    ]);
    const result = parsePayrollSheet(bytes);
    expect(result.problems).toEqual([]);
    expect(result.rows).toEqual([
      { line: 2, name: 'Ada Okafor', code: ADA, amountMinor: 15_000_000, note: 'September' },
      { line: 3, name: 'Tunde Bello', code: TUNDE, amountMinor: 9_550_050 },
      { line: 5, name: 'Chidi', code: CHIDI, amountMinor: 2_000_050 },
    ]);
  });

  it('reads an old .xls too', () => {
    const result = parsePayrollBytes(workbookBytes([['Name', 'Code', 'Amount'], ['Ada', ADA, 1000]], 'xls'));
    expect(result.problems).toEqual([]);
    expect(result.rows[0]).toMatchObject({ name: 'Ada', amountMinor: 100_000 });
  });

  it('cleans float noise from a formula but never rounds a real third decimal', () => {
    const result = parsePayrollSheet(
      workbookBytes([
        ['Name', 'Code', 'Amount'],
        ['Ada', ADA, 0.1 + 0.2],
        ['Tunde', TUNDE, 1000.123],
      ]),
    );
    expect(result.rows).toEqual([{ line: 2, name: 'Ada', code: ADA, amountMinor: 30 }]);
    expect(result.problems.map((p) => p.message)).toEqual(['Row 3: amounts can have at most 2 decimal places.']);
  });

  it('numbers rows from where the sheet starts', () => {
    const sheet = utils.sheet_add_aoa({}, [['Name', 'Code', 'Amount'], ['Ada', ADA, 5]], { origin: 'A3' });
    const book = utils.book_new();
    utils.book_append_sheet(book, sheet, 'S');
    const result = parsePayrollSheet(new Uint8Array(write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer));
    expect(result.rows[0]!.line).toBe(4);
  });

  it('reads only the first sheet', () => {
    const book = utils.book_new();
    utils.book_append_sheet(book, utils.aoa_to_sheet([['Name', 'Code', 'Amount'], ['Ada', ADA, 5]]), 'First');
    utils.book_append_sheet(book, utils.aoa_to_sheet([['Name', 'Code', 'Amount'], ['Tunde', TUNDE, 9]]), 'Second');
    const result = parsePayrollSheet(new Uint8Array(write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer));
    expect(result.rows.map((row) => row.name)).toEqual(['Ada']);
  });

  it('a file that is not a spreadsheet is a message, not a crash', () => {
    expect(parsePayrollSheet(new Uint8Array([1, 2, 3, 4])).problems).toHaveLength(1);
    expect(parsePayrollBytes(new Uint8Array()).problems[0]!.message).toBe('That file is empty.');
  });

  it('parsePayrollBytes sends plain text to the CSV reader', () => {
    const bytes = new TextEncoder().encode(`﻿Name,Code,Amount\r\nAda,${ADA},"1,000"\r\n`);
    expect(parsePayrollBytes(bytes).rows).toEqual([{ line: 2, name: 'Ada', code: ADA, amountMinor: 100_000 }]);
  });
});
