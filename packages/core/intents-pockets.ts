import type { Address, Hex } from 'viem';
import { z } from 'zod';

import { INTENTS_CONTRACT, NEAR_RPC, ONECLICK_API_BASE, intentsAccountOf, intentsSignature } from './intents-held';

/**
 * Currency pockets: dollars, euros and pounds held side by side in the
 * person's own NEAR Intents account, the one named by their Entole address
 * (`intentsAccountOf`). Only their own key, made by their passkey, can move
 * what is in it.
 *
 * - Reading a pocket is a public read of `intents.near` (`mt_batch_balance_of`).
 * - Adding to a pocket from another app is a 1Click quote that delivers into
 *   the Intents account (`recipientType: 'INTENTS'`): the person sends from
 *   the app they already use, to a one-time scan code.
 * - Swapping between pockets is a 1Click quote from the Intents account to the
 *   Intents account. 1Click writes the intent (one `transfer` of the exact
 *   amount to the quote's own deposit address), the person's key signs it
 *   ERC-191, 1Click carries it out. No fee money is needed anywhere.
 *
 * Checked live on 12 November 2026: `/v0/quote` (INTENTS→INTENTS, USDC→EURe)
 * and `/v0/generate-intent` both answer without a partner key; without one
 * 1Click adds 25 basis points, with one a stablecoin pair costs 1.
 *
 * There is no test network for any of this: every quote that is acted on
 * moves real money.
 */

// ---------------------------------------------------------------- assets

export const ASSETS = {
  nearUsdc: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
  nearUsdt: 'nep141:usdt.tether-token.near',
  tronUsdt: 'nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near',
  solUsdc: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near',
  solUsdt: 'nep141:sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near',
  baseUsdc: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
  arbUsdc: 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near',
  ethUsdc: 'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near',
  ethUsdt: 'nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near',
  gnosisEure: 'nep141:gnosis-0x420ca0f9b9b604ce0fd9c18ef134c705e5fa3430.omft.near',
  gnosisGbpe: 'nep141:gnosis-0x5cb9073902f2035222b9749f8fb0c9bfe5527108.omft.near',
} as const;

export const POCKET_IDS = ['usd', 'eur', 'gbp'] as const;
export type PocketId = (typeof POCKET_IDS)[number];
export type PocketCurrency = 'USD' | 'EUR' | 'GBP';

export type PocketDefinition = {
  id: PocketId;
  currency: PocketCurrency;
  words: string;
  sign: string;
  /** What a swap into this pocket delivers. */
  primary: string;
  /** Everything counted in this pocket, with each one's decimals. */
  holds: readonly { assetId: string; decimals: number }[];
};

export const POCKETS: readonly PocketDefinition[] = [
  {
    id: 'usd',
    currency: 'USD',
    words: 'Dollars',
    sign: '$',
    primary: ASSETS.nearUsdc,
    holds: [
      { assetId: ASSETS.nearUsdc, decimals: 6 },
      { assetId: ASSETS.nearUsdt, decimals: 6 },
      // Money from Tron or Solana that could not be completed is held as these (aurora-intents.ts).
      { assetId: ASSETS.tronUsdt, decimals: 6 },
      { assetId: ASSETS.solUsdc, decimals: 6 },
    ],
  },
  { id: 'eur', currency: 'EUR', words: 'Euros', sign: '€', primary: ASSETS.gnosisEure, holds: [{ assetId: ASSETS.gnosisEure, decimals: 18 }] },
  { id: 'gbp', currency: 'GBP', words: 'Pounds', sign: '£', primary: ASSETS.gnosisGbpe, holds: [{ assetId: ASSETS.gnosisGbpe, decimals: 18 }] },
];

export function pocketOf(id: PocketId): PocketDefinition {
  return POCKETS.find((pocket) => pocket.id === id)!;
}

const decimalsOf = (assetId: string) => {
  for (const pocket of POCKETS) for (const held of pocket.holds) if (held.assetId === assetId) return held.decimals;
  for (const source of PAY_IN_SOURCES) if (source.assetId === assetId) return source.decimals;
  return undefined;
};

/** Token units to the currency's cents, rounded down: a pocket never shows more than is there. */
export function unitsToCents(units: bigint, decimals: number): number {
  const scale = 10n ** BigInt(Math.max(0, decimals - 2));
  return Number(units / scale);
}

export function centsToUnits(cents: number, decimals: number): bigint {
  if (!Number.isInteger(cents) || cents < 0) throw new Error('cents must be a whole, positive number');
  return BigInt(cents) * 10n ** BigInt(Math.max(0, decimals - 2));
}

/** "€1,204.50". Cents always shown: these are foreign currency balances. */
export function formatPocketAmount(cents: number, currency: PocketCurrency): string {
  const sign = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '£';
  const whole = Math.floor(Math.abs(cents) / 100).toLocaleString('en-NG');
  const fraction = String(Math.abs(cents) % 100).padStart(2, '0');
  return `${cents < 0 ? '−' : ''}${sign}${whole}.${fraction}`;
}

// ------------------------------------------------------- where money is from

/**
 * What someone can pay in from: what they hold elsewhere, named the way their
 * own app names it. The names are the person's words for their other app, so
 * "USDT on Tron" is fine to show.
 */
export const PAY_IN_SOURCES = [
  { id: 'tron-usdt', asset: 'USDT', place: 'Tron', assetId: ASSETS.tronUsdt, decimals: 6, currency: 'USD' },
  { id: 'solana-usdc', asset: 'USDC', place: 'Solana', assetId: ASSETS.solUsdc, decimals: 6, currency: 'USD' },
  { id: 'solana-usdt', asset: 'USDT', place: 'Solana', assetId: ASSETS.solUsdt, decimals: 6, currency: 'USD' },
  { id: 'base-usdc', asset: 'USDC', place: 'Base', assetId: ASSETS.baseUsdc, decimals: 6, currency: 'USD' },
  { id: 'arbitrum-usdc', asset: 'USDC', place: 'Arbitrum', assetId: ASSETS.arbUsdc, decimals: 6, currency: 'USD' },
  { id: 'ethereum-usdc', asset: 'USDC', place: 'Ethereum', assetId: ASSETS.ethUsdc, decimals: 6, currency: 'USD' },
  { id: 'ethereum-usdt', asset: 'USDT', place: 'Ethereum', assetId: ASSETS.ethUsdt, decimals: 6, currency: 'USD' },
  { id: 'gnosis-eure', asset: 'EURe', place: 'Gnosis', assetId: ASSETS.gnosisEure, decimals: 18, currency: 'EUR' },
  { id: 'gnosis-gbpe', asset: 'GBPe', place: 'Gnosis', assetId: ASSETS.gnosisGbpe, decimals: 18, currency: 'GBP' },
] as const;

export type PayInSource = (typeof PAY_IN_SOURCES)[number];
export type PayInSourceId = PayInSource['id'];
export const PAY_IN_SOURCE_IDS = PAY_IN_SOURCES.map((source) => source.id) as [PayInSourceId, ...PayInSourceId[]];

export function payInSource(id: string): PayInSource | undefined {
  return PAY_IN_SOURCES.find((source) => source.id === id);
}

export function payInSourceLabel(source: Pick<PayInSource, 'asset' | 'place'>): string {
  return `${source.asset} on ${source.place}`;
}

// ------------------------------------------------------------- balances

export type PocketBalance = {
  id: PocketId;
  currency: PocketCurrency;
  cents: number;
  holdings: { assetId: string; units: string }[];
};

function base64Of(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const rpcAnswerSchema = z.object({ result: z.object({ result: z.array(z.number().int().min(0).max(255)) }) });

/** Every pocket's balance, in one public read of the Intents contract. */
export async function readPockets(options: { owner: Address; rpc?: string; fetch?: typeof fetch }): Promise<PocketBalance[]> {
  const tokenIds = POCKETS.flatMap((pocket) => pocket.holds.map((held) => held.assetId));
  const response = await (options.fetch ?? fetch)(options.rpc ?? NEAR_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'pockets',
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'final',
        account_id: INTENTS_CONTRACT,
        method_name: 'mt_batch_balance_of',
        args_base64: base64Of(JSON.stringify({ account_id: intentsAccountOf(options.owner), token_ids: tokenIds })),
      },
    }),
  });
  if (!response.ok) throw new Error(`NEAR RPC ${response.status}`);
  const parsed = rpcAnswerSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('NEAR RPC answered something else');
  const amounts = z.array(z.string().regex(/^\d+$/)).length(tokenIds.length)
    .parse(JSON.parse(new TextDecoder().decode(new Uint8Array(parsed.data.result.result))));
  let index = 0;
  return POCKETS.map((pocket) => {
    const holdings = pocket.holds.map((held) => ({ assetId: held.assetId, units: amounts[index++]!, decimals: held.decimals }));
    return {
      id: pocket.id,
      currency: pocket.currency,
      cents: holdings.reduce((sum, held) => sum + unitsToCents(BigInt(held.units), held.decimals), 0),
      holdings: holdings.filter((held) => held.units !== '0').map(({ assetId, units }) => ({ assetId, units })),
    };
  });
}

// ---------------------------------------------------------------- prices

export const oneClickTokenSchema = z.object({
  assetId: z.string(),
  decimals: z.number().int().nonnegative(),
  blockchain: z.string().optional(),
  symbol: z.string().optional(),
  price: z.number().nonnegative().optional(),
  priceUpdatedAt: z.string().optional(),
}).passthrough();

/** Dollar price per whole unit of each pocket's main asset, from 1Click's public list. */
export async function readPocketPrices(options: { apiBase?: string; fetch?: typeof fetch } = {}): Promise<Record<PocketId, number | null>> {
  const response = await (options.fetch ?? fetch)(`${(options.apiBase ?? ONECLICK_API_BASE).replace(/\/$/, '')}/v0/tokens`, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`1Click /v0/tokens ${response.status}`);
  const tokens = z.array(oneClickTokenSchema).parse(await response.json());
  const priceOf = (assetId: string) => tokens.find((token) => token.assetId === assetId)?.price ?? null;
  return { usd: priceOf(ASSETS.nearUsdc), eur: priceOf(ASSETS.gnosisEure), gbp: priceOf(ASSETS.gnosisGbpe) };
}

/** A pocket's worth in US cents at a dollar price per whole unit; null without a price. */
export function pocketInUsdCents(cents: number, price: number | null): number | null {
  if (price === null || !Number.isFinite(price)) return null;
  return Math.floor(cents * price);
}

// ------------------------------------------------------------- 1Click calls

export type OneClickClient = { apiKey?: string; apiBase?: string; fetch?: typeof fetch; now?: () => Date };

export class OneClickError extends Error {
  constructor(readonly path: string, readonly status: number, readonly reason: string) {
    super(`1Click ${path} ${status}: ${reason}`);
  }
}

async function call<T>(client: OneClickClient, path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
  if (client.apiKey) headers['X-API-Key'] = client.apiKey;
  const response = await (client.fetch ?? fetch)(`${(client.apiBase ?? ONECLICK_API_BASE).replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message = z.object({ message: z.string() }).safeParse(json);
    throw new OneClickError(path, response.status, message.success ? message.data.message : 'refused');
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new OneClickError(path, response.status, 'answered something else');
  return parsed.data;
}

const quoteSchema = z.object({
  correlationId: z.string().optional(),
  quote: z.object({
    depositAddress: z.string().min(1).optional(),
    depositMemo: z.string().optional(),
    amountIn: z.string().regex(/^\d+$/),
    minAmountIn: z.string().regex(/^\d+$/).optional(),
    amountOut: z.string().regex(/^\d+$/),
    minAmountOut: z.string().regex(/^\d+$/).optional(),
    deadline: z.string().optional(),
    timeEstimate: z.number().optional(),
  }),
});

export type PocketQuote = {
  depositAddress: string;
  amountInUnits: string;
  amountOutUnits: string;
  minAmountOutUnits: string;
  deadline: string | null;
  etaSeconds: number;
  correlationId: string | null;
};

function toPocketQuote(answer: z.infer<typeof quoteSchema>): PocketQuote {
  if (!answer.quote.depositAddress) throw new OneClickError('/v0/quote', 200, 'no deposit address');
  if (answer.quote.depositMemo) throw new OneClickError('/v0/quote', 200, 'needs a memo');
  return {
    depositAddress: answer.quote.depositAddress,
    amountInUnits: answer.quote.amountIn,
    amountOutUnits: answer.quote.amountOut,
    minAmountOutUnits: answer.quote.minAmountOut ?? answer.quote.amountOut,
    deadline: answer.quote.deadline ?? null,
    etaSeconds: answer.quote.timeEstimate ?? 60,
    correlationId: answer.correlationId ?? null,
  };
}

const QUOTE_WINDOW_MS = 30 * 60 * 1000;
const SLIPPAGE_BPS = 50;

// ------------------------------------------------------------------ swap

export const generatedIntentSchema = z.object({ standard: z.literal('erc191'), payload: z.string().min(1).max(20_000) });
export type GeneratedIntent = z.infer<typeof generatedIntentSchema>;

const intentPayloadSchema = z.object({
  signer_id: z.string(),
  verifying_contract: z.string(),
  deadline: z.string(),
  nonce: z.string(),
  intents: z.array(z.object({
    intent: z.string(),
    receiver_id: z.string().optional(),
    tokens: z.record(z.string(), z.string()).optional(),
  }).passthrough()),
});

/**
 * The intent 1Click wrote must do exactly one thing: move this amount of this
 * asset from the person's own account to this quote's deposit address. Read
 * before it is put in front of the person to confirm.
 */
export function checkSwapIntent(intent: GeneratedIntent, expected: { owner: Address; depositAddress: string; assetId: string; units: string; now: Date }): void {
  const payload = intentPayloadSchema.parse(JSON.parse(intent.payload));
  const fail = (why: string) => {
    throw new Error(`The intent was not the one asked for: ${why}.`);
  };
  if (payload.signer_id.toLowerCase() !== intentsAccountOf(expected.owner)) fail('someone else signs it');
  if (payload.verifying_contract !== INTENTS_CONTRACT) fail('another contract');
  if (Date.parse(payload.deadline) <= expected.now.getTime()) fail('already expired');
  if (payload.intents.length !== 1) fail('more than one step');
  const step = payload.intents[0]!;
  if (step.intent !== 'transfer' || step.receiver_id !== expected.depositAddress) fail('it goes somewhere else');
  const tokens = Object.entries(step.tokens ?? {});
  if (tokens.length !== 1 || tokens[0]![0] !== expected.assetId || tokens[0]![1] !== expected.units) fail('a different amount');
}

/** Which of a pocket's holdings pays for a swap: the largest that covers it. */
export function holdingFor(balance: PocketBalance, units: (decimals: number) => bigint): { assetId: string; units: bigint } | null {
  const pocket = pocketOf(balance.id);
  const options = balance.holdings
    .map((held) => ({ assetId: held.assetId, have: BigInt(held.units), need: units(decimalsOf(held.assetId) ?? 6) }))
    .filter((held) => held.have >= held.need)
    .sort((a, b) => (a.assetId === pocket.primary ? -1 : b.assetId === pocket.primary ? 1 : Number(b.have - a.have)));
  const first = options[0];
  return first ? { assetId: first.assetId, units: first.need } : null;
}

export type PreparedSwap = {
  from: PocketId;
  to: PocketId;
  assetIn: string;
  quote: PocketQuote;
  /** What arrives, in the receiving pocket's cents (and the least it can be). */
  receivesCents: number;
  receivesAtLeastCents: number;
  intent: GeneratedIntent;
};

export async function prepareSwap(
  input: { owner: Address; from: PocketId; to: PocketId; cents: number; balance: PocketBalance },
  client: OneClickClient,
): Promise<PreparedSwap> {
  if (input.from === input.to) throw new Error('A swap needs two different pockets.');
  const holding = holdingFor(input.balance, (decimals) => centsToUnits(input.cents, decimals));
  if (!holding) throw new OneClickError('/v0/quote', 400, 'not enough in that pocket');
  const target = pocketOf(input.to);
  const targetDecimals = target.holds[0]!.decimals;
  const now = (client.now ?? (() => new Date()))();
  const account = intentsAccountOf(input.owner);
  const answer = await call(client, '/v0/quote', {
    dry: false,
    swapType: 'EXACT_INPUT',
    slippageTolerance: SLIPPAGE_BPS,
    depositType: 'INTENTS',
    originAsset: holding.assetId,
    destinationAsset: target.primary,
    amount: holding.units.toString(),
    refundTo: account,
    refundType: 'INTENTS',
    recipient: account,
    recipientType: 'INTENTS',
    deadline: new Date(now.getTime() + QUOTE_WINDOW_MS).toISOString(),
    referral: 'entole',
  }, quoteSchema);
  const quote = toPocketQuote(answer);
  const { intent } = await call(client, '/v0/generate-intent', {
    type: 'swap_transfer',
    standard: 'erc191',
    signerId: account,
    depositAddress: quote.depositAddress,
  }, z.object({ intent: generatedIntentSchema }));
  checkSwapIntent(intent, { owner: input.owner, depositAddress: quote.depositAddress, assetId: holding.assetId, units: holding.units.toString(), now });
  return {
    from: input.from,
    to: input.to,
    assetIn: holding.assetId,
    quote,
    receivesCents: unitsToCents(BigInt(quote.amountOutUnits), targetDecimals),
    receivesAtLeastCents: unitsToCents(BigInt(quote.minAmountOutUnits), targetDecimals),
    intent,
  };
}

export type SwapPreview = { from: PocketId; to: PocketId; cents: number; receivesCents: number; receivesAtLeastCents: number; etaSeconds: number };

/**
 * What a swap would give at today's rate, without the money to make it: a dry
 * quote, so someone with an empty pocket can see the rate before adding to it.
 * Nothing can be signed or sent from it.
 */
export async function previewSwap(input: { owner: Address; from: PocketId; to: PocketId; cents: number }, client: OneClickClient): Promise<SwapPreview> {
  if (input.from === input.to) throw new Error('A swap needs two different pockets.');
  const source = pocketOf(input.from);
  const target = pocketOf(input.to);
  const now = (client.now ?? (() => new Date()))();
  const account = intentsAccountOf(input.owner);
  const answer = await call(client, '/v0/quote', {
    dry: true,
    swapType: 'EXACT_INPUT',
    slippageTolerance: SLIPPAGE_BPS,
    depositType: 'INTENTS',
    originAsset: source.primary,
    destinationAsset: target.primary,
    amount: centsToUnits(input.cents, source.holds[0]!.decimals).toString(),
    refundTo: account,
    refundType: 'INTENTS',
    recipient: account,
    recipientType: 'INTENTS',
    deadline: new Date(now.getTime() + QUOTE_WINDOW_MS).toISOString(),
    referral: 'entole',
  }, quoteSchema);
  // A dry quote has no deposit address: there is nowhere to send, by design.
  const targetDecimals = target.holds[0]!.decimals;
  return {
    from: input.from,
    to: input.to,
    cents: input.cents,
    receivesCents: unitsToCents(BigInt(answer.quote.amountOut), targetDecimals),
    receivesAtLeastCents: unitsToCents(BigInt(answer.quote.minAmountOut ?? answer.quote.amountOut), targetDecimals),
    etaSeconds: answer.quote.timeEstimate ?? 60,
  };
}

export async function submitSwap(input: { intent: GeneratedIntent; signature: Hex }, client: OneClickClient): Promise<string> {
  const { intentHash } = await call(client, '/v0/submit-intent', {
    type: 'swap_transfer',
    signedData: { ...input.intent, signature: intentsSignature(input.signature) },
  }, z.object({ intentHash: z.string().min(1) }));
  return intentHash;
}

// ------------------------------------------------------ paying into a pocket

export type PocketDepositRequest = {
  /** Whose Intents account receives it. */
  recipient: Address;
  source: PayInSource;
  pocket: PocketId;
  /**
   * - `send`: the payer says how much they send (adding to one's own pocket).
   * - `receive`: the amount that must arrive (paying an invoice).
   */
  exact: 'send' | 'receive';
  cents: number;
};

/** A one-time address on the payer's network that delivers into a pocket. */
export async function requestPocketDeposit(input: PocketDepositRequest, client: OneClickClient): Promise<PocketQuote & { receivesCents: number }> {
  const target = pocketOf(input.pocket);
  const targetDecimals = target.holds[0]!.decimals;
  const now = (client.now ?? (() => new Date()))();
  const account = intentsAccountOf(input.recipient);
  const amount = input.exact === 'send' ? centsToUnits(input.cents, input.source.decimals) : centsToUnits(input.cents, targetDecimals);
  const answer = await call(client, '/v0/quote', {
    dry: false,
    swapType: input.exact === 'send' ? 'FLEX_INPUT' : 'EXACT_OUTPUT',
    slippageTolerance: 100,
    depositType: 'ORIGIN_CHAIN',
    depositMode: 'SIMPLE',
    originAsset: input.source.assetId,
    destinationAsset: target.primary,
    amount: amount.toString(),
    // Anything that cannot be completed is held in the receiver's Intents
    // account: nobody is asked for an address on the payer's network.
    refundTo: account,
    refundType: 'INTENTS',
    recipient: account,
    recipientType: 'INTENTS',
    deadline: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    referral: 'entole',
  }, quoteSchema);
  const quote = toPocketQuote(answer);
  return { ...quote, receivesCents: unitsToCents(BigInt(quote.amountOutUnits), targetDecimals) };
}

// ----------------------------------------------------------------- status

export type MovementState = 'waiting' | 'on_its_way' | 'done' | 'too_little' | 'returned' | 'failed';

const STATES: Record<string, MovementState> = {
  PENDING_DEPOSIT: 'waiting',
  KNOWN_DEPOSIT_TX: 'on_its_way',
  PROCESSING: 'on_its_way',
  SUCCESS: 'done',
  INCOMPLETE_DEPOSIT: 'too_little',
  REFUNDED: 'returned',
  FAILED: 'failed',
};

export const statusAnswerSchema = z.object({
  status: z.string(),
  correlationId: z.string().optional(),
  swapDetails: z.object({
    amountOut: z.string().nullish(),
    amountIn: z.string().nullish(),
    refundedAmount: z.string().nullish(),
  }).passthrough().nullish(),
}).passthrough();

export type MovementStatus = { state: MovementState; amountOutUnits: string | null; correlationId: string | null };

/** Where a quote's money has got to. Unknown statuses read as still on the way. */
export async function readMovement(depositAddress: string, client: OneClickClient): Promise<MovementStatus | null> {
  const url = `${(client.apiBase ?? ONECLICK_API_BASE).replace(/\/$/, '')}/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (client.apiKey) headers['X-API-Key'] = client.apiKey;
  const response = await (client.fetch ?? fetch)(url, { headers });
  if (response.status === 404) return null;
  if (!response.ok) throw new OneClickError('/v0/status', response.status, 'refused');
  const parsed = statusAnswerSchema.safeParse(await response.json());
  if (!parsed.success) throw new OneClickError('/v0/status', response.status, 'answered something else');
  return {
    state: STATES[parsed.data.status] ?? 'on_its_way',
    amountOutUnits: parsed.data.swapDetails?.amountOut ?? null,
    correlationId: parsed.data.correlationId ?? null,
  };
}

export const MOVEMENT_WORDS: Record<MovementState, string> = {
  waiting: 'Waiting for it to be sent',
  on_its_way: 'On its way',
  done: 'Arrived',
  too_little: 'Less arrived than was asked for',
  returned: 'Sent back',
  failed: 'Did not go through',
};
