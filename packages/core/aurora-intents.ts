import { z } from 'zod';

/**
 * Aurora Intents: money in from the networks the other conversion partner does
 * not reach for us. Above all USDT on Tron, which is how most people in
 * Nigeria hold dollars, and USDC on Solana.
 *
 * How it works, checked against the live service on 10 October 2026:
 *
 * - `POST {base}/api/quote/{key}` prices one deposit of a stated amount and,
 *   unless `dry`, answers with an address on the sending network that is good
 *   for that deposit only, until a deadline.
 * - The person sends to it from the app they already use. Aurora delivers
 *   USDC on Monad to `recipient`. It cannot deliver the account's own money
 *   (AUSD), so `recipient` is a holding address that converts on arrival; the
 *   server composes the two (see `apps/web/app/api/aurora/deposit`).
 * - `GET {base}/api/status/{key}?depositAddress=` says how far it has got.
 *
 * Two things the service insists on, which shape the screen:
 *
 * - **An amount.** Every deposit is priced for a stated amount. It accepts
 *   that amount or a little under it (`minimumUnits`), because the app someone
 *   sends from often takes its own fee out of what arrives.
 * - **Somewhere to send it back.** `refundTo` has to be an account on the
 *   sending network, so the person supplies one. Nothing of ours is in the
 *   path of a failed deposit.
 *
 * There is no test network: a real deposit moves real money. `dry: true`
 * prices a deposit and makes nothing.
 *
 * The key is a public identifier (Aurora's own docs: "not confidential"), but
 * it is still read on the server, where the rate limit can be held.
 */

export const AURORA_API_BASE = 'https://intents-api.aurora.dev';

/** What Aurora delivers on Monad that the holding address then converts. */
export const AURORA_MONAD_USDC = 'nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx';

/** How long the person has to make the transfer. */
export const AURORA_DEPOSIT_WINDOW_MS = 60 * 60 * 1000;

/** One percent, in hundredths of a percent: how far under the stated amount still counts. */
const SLIPPAGE_BPS = 100;

/**
 * What can be sent in this way. Named the way the other app names it, as in
 * `deposit-sources.ts`. `returnAccount` is the shape an account has on that
 * network, used to refuse a slip of the thumb before Aurora does.
 */
export const AURORA_SOURCES = [
  {
    id: 'tron-usdt',
    asset: 'USDT',
    place: 'Tron',
    assetId: 'nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near',
    decimals: 6,
    returnAccount: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  },
  {
    id: 'solana-usdc',
    asset: 'USDC',
    place: 'Solana',
    assetId: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near',
    decimals: 6,
    returnAccount: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  },
] as const;

export type AuroraSource = (typeof AURORA_SOURCES)[number];
export type AuroraSourceId = AuroraSource['id'];

export const AURORA_SOURCE_IDS = AURORA_SOURCES.map((source) => source.id) as [AuroraSourceId, ...AuroraSourceId[]];

export function auroraSource(id: string): AuroraSource | undefined {
  return AURORA_SOURCES.find((source) => source.id === id);
}

/** Whether `account` could be an account on the network `source` is sent from. */
export function isReturnAccount(source: AuroraSource, account: string): boolean {
  return source.returnAccount.test(account.trim());
}

export type AuroraErrorCode =
  /** No key, so nothing was asked. */
  | 'not_configured'
  /** Under what the service accepts right now. `minimumDollars` says how much that is, when it said. */
  | 'amount_too_small'
  /** The service does not accept the return account. */
  | 'bad_return_account'
  /** Refused for a reason not listed here, or not reachable. */
  | 'partner_unavailable';

export class AuroraError extends Error {
  constructor(
    readonly code: AuroraErrorCode,
    readonly minimumDollars?: number,
  ) {
    super(code);
    this.name = 'AuroraError';
  }
}

export type AuroraConfig = {
  apiKey: string;
  apiBase?: string;
  fetch?: typeof fetch;
  now?: () => Date;
};

const digits = z.string().regex(/^\d+$/);

const quoteResponseSchema = z.object({
  quote: z.object({
    /** Absent on a dry run. */
    depositAddress: z.string().min(1).optional(),
    /** Set when the service wants a memo sent with the transfer. We ask for none. */
    depositMemo: z.string().optional().nullable(),
    deadline: z.string().optional(),
    amountIn: digits,
    minAmountIn: digits,
    amountOut: digits,
    minAmountOut: digits,
    timeEstimate: z.number().nonnegative(),
  }),
});

const refusalSchema = z.object({ message: z.string() });

export type AuroraDepositRequest = {
  source: AuroraSourceId;
  /** What the person says they are sending, in the sent asset's smallest unit. */
  amountUnits: bigint;
  /** Where the USDC lands on Monad. An address; never rendered. */
  recipient: string;
  /** An account on the sending network that a failed deposit returns to. */
  returnAccount: string;
  /** Prices the deposit and makes no address. */
  dry?: boolean;
};

export type AuroraDeposit = {
  /** Where to send. For a scan code or a copy button only. Absent on a dry run. */
  depositAddress?: string;
  /** The amount asked about, and the least that still counts. */
  amountUnits: bigint;
  minimumUnits: bigint;
  /** USDC (six decimals) expected on Monad, and the least it may be. */
  arrivesUnits: bigint;
  arrivesAtLeastUnits: bigint;
  /** ISO time after which a transfer to the address may not be honoured. */
  deadline?: string;
  /** Seconds from the transfer being confirmed to the money arriving. */
  etaSeconds: number;
};

function requireKey(config: AuroraConfig | undefined): AuroraConfig {
  if (!config?.apiKey) throw new AuroraError('not_configured');
  return config;
}

/** "Temporary swap limits: minimum swap amount is $100" to 100. */
function minimumFrom(message: string): number | undefined {
  const match = /minimum[^$]*\$\s*([\d,]+(?:\.\d+)?)/i.exec(message);
  if (!match) return undefined;
  const value = Number(match[1]!.replace(/,/g, ''));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Prices one deposit and, unless `dry`, gets the address to send it to.
 * Throws `AuroraError`; never answers with an address it did not receive.
 */
export async function requestAuroraDeposit(request: AuroraDepositRequest, config?: AuroraConfig): Promise<AuroraDeposit> {
  const resolved = requireKey(config);
  const source = auroraSource(request.source);
  if (!source) throw new AuroraError('partner_unavailable');
  if (request.amountUnits <= 0n) throw new AuroraError('amount_too_small');
  const returnAccount = request.returnAccount.trim();
  if (!isReturnAccount(source, returnAccount)) throw new AuroraError('bad_return_account');

  const fetchImpl = resolved.fetch ?? fetch;
  const now = (resolved.now ?? (() => new Date()))();
  const base = (resolved.apiBase ?? AURORA_API_BASE).replace(/\/$/, '');

  let response: Response;
  try {
    response = await fetchImpl(`${base}/api/quote/${encodeURIComponent(resolved.apiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        dry: request.dry === true,
        // Accepts the stated amount or a little under: the app someone sends
        // from often takes its own fee out of what arrives.
        swapType: 'FLEX_INPUT',
        // A plain transfer to an address, with no memo to get wrong.
        depositMode: 'SIMPLE',
        depositType: 'ORIGIN_CHAIN',
        slippageTolerance: SLIPPAGE_BPS,
        originAsset: source.assetId,
        destinationAsset: AURORA_MONAD_USDC,
        amount: request.amountUnits.toString(),
        refundTo: returnAccount,
        refundType: 'ORIGIN_CHAIN',
        recipient: request.recipient,
        recipientType: 'DESTINATION_CHAIN',
        deadline: new Date(now.getTime() + AURORA_DEPOSIT_WINDOW_MS).toISOString(),
      }),
    });
  } catch {
    throw new AuroraError('partner_unavailable');
  }

  if (!response.ok) {
    const refusal = refusalSchema.safeParse(await response.json().catch(() => null));
    const message = refusal.success ? refusal.data.message : '';
    if (/minimum/i.test(message)) throw new AuroraError('amount_too_small', minimumFrom(message));
    if (/refundTo/i.test(message)) throw new AuroraError('bad_return_account');
    throw new AuroraError('partner_unavailable');
  }

  const parsed = quoteResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new AuroraError('partner_unavailable');
  const { quote } = parsed.data;
  // A memo would have to travel with the transfer, and a scan code cannot
  // carry one. We asked for none; if one comes back, do not offer the address.
  if (quote.depositMemo) throw new AuroraError('partner_unavailable');
  if (request.dry !== true && !quote.depositAddress) throw new AuroraError('partner_unavailable');

  return {
    ...(request.dry !== true && quote.depositAddress ? { depositAddress: quote.depositAddress } : {}),
    amountUnits: BigInt(quote.amountIn),
    minimumUnits: BigInt(quote.minAmountIn),
    arrivesUnits: BigInt(quote.amountOut),
    arrivesAtLeastUnits: BigInt(quote.minAmountOut),
    ...(quote.deadline ? { deadline: quote.deadline } : {}),
    etaSeconds: quote.timeEstimate,
  };
}

/** How far a deposit has got, in the words a screen needs. */
export type AuroraDepositState =
  /** Nothing has been sent to the address yet. */
  | 'waiting'
  /** The transfer has been seen and is being carried across. */
  | 'on_its_way'
  /** USDC has been delivered on Monad. */
  | 'arrived'
  /** Less was sent than the least that counts. It is going back. */
  | 'too_little'
  /** It could not be completed and has gone back to the return account. */
  | 'returned'
  /** It could not be completed. */
  | 'failed';

const STATES: Record<string, AuroraDepositState> = {
  PENDING_DEPOSIT: 'waiting',
  KNOWN_DEPOSIT_TX: 'on_its_way',
  PROCESSING: 'on_its_way',
  SUCCESS: 'arrived',
  INCOMPLETE_DEPOSIT: 'too_little',
  REFUNDED: 'returned',
  FAILED: 'failed',
};

const statusResponseSchema = z.object({ status: z.string() });

/** Reads one deposit's progress. An answer it does not recognise is an error, not a guess. */
export async function readAuroraDeposit(depositAddress: string, config?: AuroraConfig): Promise<AuroraDepositState> {
  const resolved = requireKey(config);
  const fetchImpl = resolved.fetch ?? fetch;
  const base = (resolved.apiBase ?? AURORA_API_BASE).replace(/\/$/, '');

  let response: Response;
  try {
    response = await fetchImpl(
      `${base}/api/status/${encodeURIComponent(resolved.apiKey)}?depositAddress=${encodeURIComponent(depositAddress)}`,
      { headers: { accept: 'application/json' } },
    );
  } catch {
    throw new AuroraError('partner_unavailable');
  }
  if (!response.ok) throw new AuroraError('partner_unavailable');
  const parsed = statusResponseSchema.safeParse(await response.json().catch(() => null));
  const state = parsed.success ? STATES[parsed.data.status] : undefined;
  if (!state) throw new AuroraError('partner_unavailable');
  return state;
}
