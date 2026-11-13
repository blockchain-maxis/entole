import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { ProofCheck } from '@entole/core/tee-proof';

import type { CheckedHardware, NearAiConfig, SealedAnswer } from '@/lib/server/near-ai';
import { pdfTextItems, readStatement, StatementReadError } from '@/lib/server/statement-read';

const samples = join(__dirname, '../../../samples/statements');
const plain = new Uint8Array(readFileSync(join(samples, 'adaeze-3-months.pdf')));
const locked = new Uint8Array(readFileSync(join(samples, 'adaeze-3-months-locked.pdf')));

const config: NearAiConfig = { apiKey: 'test', base: 'https://example.invalid/v1', statementModel: 'z-ai/glm-5.3-flash', fetch: vi.fn() };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Stands in for the model: reads each printed row the way the prompt asks
 * the model to, so the plumbing around it (PDF, rows, chunks, kobo, balance)
 * is tested on a real file without a network.
 */
function fakeModel(_config: NearAiConfig, input: { user: string }): Promise<SealedAnswer> {
  const lines = [];
  let opening: string | null = null;
  let closing: string | null = null;
  for (const row of input.user.split('\n')) {
    const open = /Opening balance: ([\d,.]+)/.exec(row);
    if (open) opening = open[1]!;
    const close = /Closing balance: ([\d,.]+)/.exec(row);
    if (close) closing = close[1]!;
    const cells = row.split(' | ');
    const day = /^(\d{2})-(\w{3})-(\d{4})$/.exec(cells[0] ?? '');
    if (!day || cells.length !== 4) continue;
    const [, narration, amount, balance] = cells;
    const credit = /^NIP FROM/.test(narration!);
    lines.push({
      date: `${day[3]}-${String(MONTHS.indexOf(day[2]!) + 1).padStart(2, '0')}-${day[1]}`,
      description: narration,
      debit: credit ? '' : amount,
      credit: credit ? amount : '',
      balance,
      kind: credit ? 'income' : 'other',
      merchant: '',
    });
  }
  const content = JSON.stringify({ opening, closing, lines });
  return Promise.resolve({ id: `chat-${Math.random()}`, content, request: new Uint8Array(), response: new Uint8Array() });
}

const pass = (id: ProofCheck['id']): ProofCheck => ({ id, part: 'model', passed: true, detail: '' });
const goodHardware = async (): Promise<CheckedHardware> => ({
  checks: (['hardware', 'not-debug', 'fresh', 'bound', 'software', 'events', 'gpu'] as const).map(pass),
  gatewayAddress: '0xgateway',
  modelAddresses: ['0xmodel'],
});
const deps = {
  random: (length: number) => new Uint8Array(length).fill(1),
  now: () => new Date('2026-11-12T12:00:00Z'),
  hardware: goodHardware,
  ask: fakeModel,
  answers: async () => pass('answers'),
};

describe('opening the PDF', () => {
  it('reads every page of a plain statement', async () => {
    const { pages, items } = await pdfTextItems(plain);
    expect(pages).toBe(4);
    expect(items.some((item) => item.str === 'SANKORE BANK PLC')).toBe(true);
  });

  it('says when a locked statement needs its password, and when the password is wrong', async () => {
    await expect(pdfTextItems(locked)).rejects.toMatchObject({ reason: 'needs_password' });
    await expect(pdfTextItems(locked, 'nope')).rejects.toMatchObject({ reason: 'wrong_password' });
    expect((await pdfTextItems(locked, 'entole2026')).pages).toBe(4);
  });

  it('refuses something that is not a PDF', async () => {
    await expect(pdfTextItems(new TextEncoder().encode('hello there'))).rejects.toBeInstanceOf(StatementReadError);
  });
});

describe('reading a statement', () => {
  it('reads the sample end to end, and it balances to the kobo', async () => {
    const reading = await readStatement({ pdf: locked, password: 'entole2026' }, config, deps);
    expect(reading.lines).toHaveLength(126);
    expect(reading.reconciliation).toMatchObject({ status: 'balanced', differenceMinor: 0, runningBreaks: 0, skipped: 0 });
    expect(reading.proof.proven).toBe(true);
  });

  it('sends nothing to hardware that failed a check', async () => {
    const ask = vi.fn(fakeModel);
    const unproven = async (): Promise<CheckedHardware> => ({ checks: [{ ...pass('gpu'), passed: false }], gatewayAddress: '0xgateway', modelAddresses: [] });
    await expect(readStatement({ pdf: plain }, config, { ...deps, hardware: unproven, ask })).rejects.toMatchObject({ reason: 'not_proven' });
    expect(ask).not.toHaveBeenCalled();
  });

  it('shows the reading as not proven when an answer\'s stamp does not check', async () => {
    const reading = await readStatement({ pdf: plain }, config, { ...deps, answers: async () => ({ ...pass('answers'), passed: false }) });
    expect(reading.proof.proven).toBe(false);
  });

  it('shows a gap, not a guess, when the model drops a line', async () => {
    const dropping = async (c: NearAiConfig, input: { user: string }) => {
      const answer = await fakeModel(c, input);
      const parsed = JSON.parse(answer.content);
      parsed.lines = parsed.lines.slice(1);
      return { ...answer, content: JSON.stringify(parsed) };
    };
    const reading = await readStatement({ pdf: plain }, config, { ...deps, ask: dropping });
    expect(reading.reconciliation.status).toBe('off');
    expect(reading.reconciliation.differenceMinor).not.toBe(0);
  });

  it('says the statement is too long, not that the reader failed, when reading runs past its time', async () => {
    const slow = (_c: NearAiConfig, input: { signal?: AbortSignal }) =>
      new Promise<never>((_resolve, reject) => input.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    await expect(readStatement({ pdf: plain }, config, { ...deps, ask: slow, deadlineMs: 20 })).rejects.toMatchObject({ reason: 'too_long' });
  });
});

describe('the statement route keeps nothing', () => {
  const sources = ['app/api/statement/read/route.ts', 'lib/server/statement-read.ts', 'lib/server/near-ai.ts'].map((path) =>
    readFileSync(join(__dirname, '..', path), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''));

  it('has no store, no records and no logging', () => {
    for (const source of sources) {
      expect(source).not.toMatch(/getRedis|getServerStore|tryGetServerStore|records|console\.|writeFile|after\(/);
    }
  });
});
