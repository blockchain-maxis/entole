import { getDocumentProxy, extractTextItems } from 'unpdf';

import {
  chunkRows,
  joinChunks,
  modelChunkSchema,
  reconcile,
  rowsFromItems,
  STATEMENT_MAX_CHUNKS,
  STATEMENT_SYSTEM_PROMPT,
  type ModelChunk,
  type Reconciliation,
  type StatementLine,
  type TextItem,
} from '@entole/core/statement';
import { newNonce, summariseProof, type ProofSummary } from '@entole/core/tee-proof';

import { askSealed, checkAnswers, checkHardware, type CheckedHardware, type NearAiConfig, type SealedAnswer } from './near-ai';

/**
 * Reading one statement, start to finish, in memory:
 *
 *   PDF bytes (+ password) → text pieces → printed rows → chunks
 *   → the sealed hardware is checked (fresh nonce)
 *   → each chunk is read there → each answer's stamp is checked
 *   → lines in kobo, balanced against the statement's own figures.
 *
 * The PDF, the password, the text and the answers live only in this
 * function's variables. Nothing is written anywhere, nothing is logged; when
 * it returns, they are gone with the request.
 */

export type ReadFailure = 'needs_password' | 'wrong_password' | 'unreadable' | 'no_text' | 'too_long' | 'not_proven' | 'model_unavailable';

export class StatementReadError extends Error {
  constructor(readonly reason: ReadFailure) {
    super(reason);
  }
}

export type StatementReading = {
  lines: StatementLine[];
  reconciliation: Reconciliation;
  proof: ProofSummary;
  pages: number;
};

/** Text pieces from every page. A locked file without its password says which. */
export async function pdfTextItems(bytes: Uint8Array, password?: string): Promise<{ items: TextItem[]; pages: number }> {
  let doc;
  try {
    // pdf.js takes over the buffer it is given; it gets a copy, so the caller's bytes stay readable.
    doc = await getDocumentProxy(bytes.slice(), password ? { password } : {});
  } catch (error) {
    const named = error as { name?: string; code?: number };
    if (named?.name === 'PasswordException') throw new StatementReadError(named.code === 2 ? 'wrong_password' : 'needs_password');
    throw new StatementReadError('unreadable');
  }
  try {
    const { items, totalPages } = await extractTextItems(doc);
    return {
      pages: totalPages,
      items: items.flatMap((page, index) => page.map((item) => ({ str: item.str, x: item.x, y: item.y, width: item.width, page: index + 1 }))),
    };
  } finally {
    await (doc as { destroy?: () => Promise<void> }).destroy?.().catch(() => undefined);
  }
}

// Every chunk at once: a reading is as slow as its slowest chunk, about a
// minute for three months of lines (measured 13 Nov 2026).
const READ_CONCURRENCY = STATEMENT_MAX_CHUNKS;
// The route stops at 120 s; past this the person hears "too long", not a timeout.
export const READ_DEADLINE_MS = 105_000;

async function inTurns<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await work(items[index]!);
    }
  }));
  return out;
}

function parseAnswer(content: string): ModelChunk {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) return { opening: null, closing: null, lines: [] };
  try {
    const parsed = modelChunkSchema.safeParse(JSON.parse(content.slice(start, end + 1)));
    if (parsed.success) return parsed.data;
  } catch {
    // An answer that is not JSON reads as no lines; the balance check then shows the gap.
  }
  return { opening: null, closing: null, lines: [] };
}

export async function readStatement(
  input: { pdf: Uint8Array; password?: string },
  config: NearAiConfig,
  deps: {
    random: (length: number) => Uint8Array;
    now: () => Date;
    hardware?: typeof checkHardware;
    ask?: typeof askSealed;
    answers?: typeof checkAnswers;
    deadlineMs?: number;
  },
): Promise<StatementReading> {
  const { items, pages } = await pdfTextItems(input.pdf, input.password);
  const rows = rowsFromItems(items);
  if (!rows.length) throw new StatementReadError('no_text');
  const chunks = chunkRows(rows);
  if (chunks.length > STATEMENT_MAX_CHUNKS) throw new StatementReadError('too_long');

  const model = config.statementModel;
  const nonce = newNonce(deps.random);
  let hardware: CheckedHardware;
  try {
    hardware = await (deps.hardware ?? checkHardware)(config, model, nonce);
  } catch {
    throw new StatementReadError('model_unavailable');
  }
  // Nothing is sent to hardware that has not passed every check.
  if (!hardware.modelAddresses.length || !hardware.gatewayAddress) throw new StatementReadError('not_proven');

  const ask = deps.ask ?? askSealed;
  const signal = AbortSignal.timeout(deps.deadlineMs ?? READ_DEADLINE_MS);
  let answers: SealedAnswer[];
  try {
    answers = await inTurns(chunks, READ_CONCURRENCY, (chunk) =>
      ask(config, { model, system: STATEMENT_SYSTEM_PROMPT, user: chunk, maxTokens: 8000, signal }));
  } catch {
    throw new StatementReadError(signal.aborted ? 'too_long' : 'model_unavailable');
  }
  const stamped = await (deps.answers ?? checkAnswers)(config, model, answers, hardware);

  const joined = joinChunks(answers.map((answer) => parseAnswer(answer.content)));
  return {
    lines: joined.lines,
    reconciliation: reconcile(joined),
    proof: summariseProof([...hardware.checks, stamped], model, deps.now()),
    pages,
  };
}
