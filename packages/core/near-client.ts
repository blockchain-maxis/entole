import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { Address, Hex } from 'viem';
import { z } from 'zod';

import { buildInvoicePaysMessage, invoicePaymentStateSchema, type InvoicePaymentState } from './invoice-pay';
import { generatedIntentSchema, POCKET_IDS, type MovementState, type PayInSourceId, type PocketId } from './intents-pockets';
import type { Movement } from './movement';
import { buildStatementMessage, reconciliationSchema, statementLineSchema, STATEMENT_MAX_BYTES } from './statement';
import { proofSummarySchema } from './tee-proof';

/**
 * The app's side of everything built on NEAR: currency pockets, swaps,
 * invoices paid from other networks and the statement reader. Same origin as
 * the other routes; every answer parsed before use; every failure plain copy.
 *
 * Moving a pocket is a movement of the person's own money: it is confirmed
 * first (fingerprint, face or passkey) through the same `confirm` as every
 * other movement, and only then signed by their own key.
 */

const MESSAGES: Record<string, string> = {
  not_configured: "This isn't available yet.",
  bad_request: 'Something was wrong with that request. Try again.',
  rate_limited: 'Too many tries. Wait a moment and try again.',
  partner_unavailable: "We can't reach the service that does this right now. Try again shortly.",
  refused: "That amount can't be swapped right now. Try a different amount.",
  amount_refused: "That amount can't be sent this way. Try a larger amount.",
  invalid_signature: "We couldn't confirm that it was you. Try again.",
  expired: 'That took too long. Try again.',
  needs_password: 'This statement is locked. Enter the password your bank sent with it.',
  wrong_password: "That password didn't open the statement. Check it and try again.",
  unreadable: "That file isn't a statement we can read. Try the PDF your bank sent.",
  no_text: 'That statement has no text we can read. It may be a scan or a photo.',
  too_long: 'That statement is too long. Try one covering six months or less.',
  not_proven: "We couldn't prove the reader was sealed, so nothing was sent to it. Try again shortly.",
  model_unavailable: "The reader isn't answering right now. Try again shortly.",
  unknown_business: "We couldn't find that business.",
  too_large: 'That file is too large. Statements up to 5 MB can be read.',
  unreachable: "We can't reach Entole right now. Check your connection.",
};

export class NearClientError extends Error {
  constructor(readonly code: string) {
    super(MESSAGES[code] ?? MESSAGES.unreachable);
  }
}

export const pocketViewSchema = z.object({
  id: z.enum(POCKET_IDS),
  currency: z.enum(['USD', 'EUR', 'GBP']),
  cents: z.number().int().nonnegative(),
  usdCents: z.number().int().nonnegative().nullable(),
  words: z.string(),
});
export type PocketView = z.infer<typeof pocketViewSchema>;

const movementStateSchema = z.object({ state: z.enum(['waiting', 'on_its_way', 'done', 'too_little', 'returned', 'failed']) });

const preparedSwapSchema = z.object({
  intent: generatedIntentSchema,
  followId: z.string(),
  receivesCents: z.number().int().nonnegative(),
  receivesAtLeastCents: z.number().int().nonnegative(),
  etaSeconds: z.number().nonnegative(),
});
export type PreparedPocketSwap = z.infer<typeof preparedSwapSchema> & { from: PocketId; to: PocketId; cents: number };

const depositSchema = z.object({
  qrPayload: z.string().min(1),
  receivesCents: z.number().int().nonnegative(),
  deadline: z.string().nullable(),
  etaSeconds: z.number().nonnegative(),
});

const invoiceQuoteSchema = z.object({
  qrPayload: z.string().min(1),
  sendCents: z.number().int().nonnegative(),
  invoiceCents: z.number().int().nonnegative(),
  deadline: z.string().nullable(),
  etaSeconds: z.number().nonnegative(),
});

export const statementReadingSchema = z.object({
  lines: z.array(statementLineSchema),
  reconciliation: reconciliationSchema,
  proof: proofSummarySchema,
  pages: z.number().int().nonnegative(),
});
export type StatementReading = z.infer<typeof statementReadingSchema>;

function base64Of(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

type Options = {
  baseUrl: string;
  fetch?: typeof fetch;
  now?: () => number;
};

async function call<T>(options: Options, path: string, body: unknown, schema: z.ZodType<T>, method: 'GET' | 'POST' = 'POST'): Promise<T> {
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(`${options.baseUrl}${path}`, {
      method,
      headers: method === 'POST' ? { 'content-type': 'application/json' } : {},
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new NearClientError('unreachable');
  }
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const code = z.object({ error: z.string() }).safeParse(json);
    throw new NearClientError(code.success ? code.data.error : 'unreachable');
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new NearClientError('unreachable');
  return parsed.data;
}

/** Calls that need no account: an invoice's payer, who may not have one. */
export function createInvoicePayClient(options: Options) {
  return {
    async quote(input: { username: string; reference: string; amountMinor: number; source: PayInSourceId }) {
      return call(options, '/api/invoice/pay', { action: 'quote', ...input }, invoiceQuoteSchema);
    },
    async state(qrPayload: string): Promise<MovementState> {
      const { state } = await call(options, `/api/invoice/pay?depositAddress=${encodeURIComponent(qrPayload)}`, null, movementStateSchema, 'GET');
      return state;
    },
  };
}

export function createNearClient(options: Options & {
  account: Address;
  sign: (message: string) => Promise<Hex>;
  confirm: (movement: Movement) => Promise<void>;
}) {
  const nowSeconds = () => Math.floor((options.now ?? Date.now)() / 1000);
  return {
    async pockets(): Promise<PocketView[]> {
      const { pockets } = await call(options, `/api/pockets?address=${options.account}`, null, z.object({ pockets: z.array(pocketViewSchema) }), 'GET');
      return pockets;
    },
    /** A one-time scan code for adding to a pocket from another app. For a scan code or a copy button only. */
    async startPocketDeposit(pocket: PocketId, source: PayInSourceId, cents: number) {
      return call(options, '/api/pockets/deposit', { address: options.account, pocket, source, cents }, depositSchema);
    },
    async pocketDepositState(qrPayload: string): Promise<MovementState> {
      const { state } = await call(options, `/api/pockets/deposit?depositAddress=${encodeURIComponent(qrPayload)}`, null, movementStateSchema, 'GET');
      return state;
    },
    /** The rate only, for a pocket that does not hold the amount yet. Nothing can be confirmed from it. */
    async previewSwap(from: PocketId, to: PocketId, cents: number): Promise<{ receivesCents: number; receivesAtLeastCents: number; etaSeconds: number }> {
      return call(
        options,
        '/api/pockets/swap',
        { action: 'preview', address: options.account, from, to, cents },
        z.object({ receivesCents: z.number().int().nonnegative(), receivesAtLeastCents: z.number().int().nonnegative(), etaSeconds: z.number().nonnegative() }),
      );
    },
    /** A quote for a swap: what arrives, and the least it can be. Nothing moves. */
    async prepareSwap(from: PocketId, to: PocketId, cents: number): Promise<PreparedPocketSwap> {
      const prepared = await call(options, '/api/pockets/swap', { action: 'prepare', address: options.account, from, to, cents }, preparedSwapSchema);
      return { ...prepared, from, to, cents };
    },
    /** Confirms with the person, signs with their key, hands it on. Resolves when 1Click has it, not when it is done. */
    async confirmSwap(prepared: PreparedPocketSwap, currencies: { from: string; to: string }): Promise<{ followId: string }> {
      await options.confirm({ kind: 'swap', cents: prepared.cents, from: currencies.from, to: currencies.to });
      const signature = await options.sign(prepared.intent.payload);
      await call(options, '/api/pockets/swap', { action: 'submit', address: options.account, intent: prepared.intent, signature }, z.object({ submitted: z.literal(true) }));
      return { followId: prepared.followId };
    },
    async swapState(followId: string): Promise<MovementState> {
      const { state } = await call(options, `/api/pockets/swap?followId=${encodeURIComponent(followId)}`, null, movementStateSchema, 'GET');
      return state;
    },
    /** Reads a statement in sealed hardware. The file and password go to the reader and nowhere else. */
    async readStatement(pdf: Uint8Array, password?: string): Promise<StatementReading> {
      if (pdf.length > STATEMENT_MAX_BYTES) throw new NearClientError('too_large');
      const encoded = base64Of(pdf);
      const timestampSeconds = nowSeconds();
      const digest = bytesToHex(sha256(utf8ToBytes(encoded)));
      const signature = await options.sign(buildStatementMessage({ account: options.account, timestampSeconds, digest }));
      return call(options, '/api/statement/read', {
        account: options.account,
        timestampSeconds,
        signature,
        pdf: encoded,
        ...(password ? { password } : {}),
      }, statementReadingSchema);
    },
    /** What each of these invoices has received from other networks, and where each payment has got to. */
    async invoicePayments(references: string[]): Promise<Record<string, InvoicePaymentState[]>> {
      if (!references.length) return {};
      const timestampSeconds = nowSeconds();
      const signature = await options.sign(buildInvoicePaysMessage({ account: options.account, timestampSeconds, references }));
      const { invoices } = await call(options, '/api/invoice/pay', {
        action: 'list',
        account: options.account,
        timestampSeconds,
        signature,
        references,
      }, z.object({ invoices: z.array(z.object({ reference: z.string(), payments: z.array(invoicePaymentStateSchema) })) }));
      return Object.fromEntries(invoices.map((invoice) => [invoice.reference, invoice.payments]));
    },
  };
}

export type NearClient = ReturnType<typeof createNearClient>;

const notSignedIn = () => Promise.reject(new NearClientError('unreachable'));

export const pendingNearClient: NearClient = {
  pockets: notSignedIn,
  startPocketDeposit: notSignedIn,
  pocketDepositState: notSignedIn,
  previewSwap: notSignedIn,
  prepareSwap: notSignedIn,
  confirmSwap: notSignedIn,
  swapState: notSignedIn,
  readStatement: notSignedIn,
  invoicePayments: async () => ({}),
};
