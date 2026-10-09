import { getAddress, isAddress, type Address } from 'viem';
import { z } from 'zod';

/**
 * Adding real money: naira in by bank transfer, dollars in the account.
 *
 * Two partners do the work, and neither is named on a screen of ours:
 *
 * 1. **Onramp.money** takes the naira and pays out USDC on Monad. It is a
 *    hosted page, reached by a link with everything filled in.
 * 2. **Relay** turns that USDC into the settlement asset. The payout does not
 *    go to the person's account: it goes to a holding address Relay gives us,
 *    and whatever lands there is converted and forwarded to the account. The
 *    person signs nothing and needs no fee balance.
 *
 * The holding address lives only inside the link. Nothing here returns it for
 * a screen to print.
 *
 * Server-side only: call this from an API route, never from a client bundle.
 * It reaches Monad mainnet and nothing else; neither partner pays out on the
 * test network.
 *
 * What was checked against the live services on 9 October 2026: Relay's
 * deposit-address quote for USDC to AUSD on Monad, and Onramp.money's public
 * price for USDC on Monad in naira. What was not: a real naira payment going
 * all the way through.
 */

/** Monad mainnet. Neither partner reaches the test network. */
export const ONRAMP_CHAIN_ID = 143;

/** USDC on Monad, as Relay lists it (verified there). Six decimals. */
export const MONAD_USDC: Address = '0x754704bc059f8c67012fed69bc8a327a5aafb603';

export const RELAY_DEFAULT_API_BASE = 'https://api.relay.link';
export const ONRAMP_MONEY_DEFAULT_API_BASE = 'https://api.onramp.money';
export const ONRAMP_MONEY_DEFAULT_PAGE = 'https://onramp.money/main/buy/';
/** Onramp.money's public app id. Our own replaces it once they issue one. */
export const ONRAMP_MONEY_PUBLIC_APP_ID = '1';

/** Onramp.money's own numbering: Monad, naira, and paying by bank transfer. */
const ONRAMP_MONEY_MONAD_CHAIN = 10525;
const ONRAMP_MONEY_NAIRA = 6;
const ONRAMP_MONEY_BANK_TRANSFER = 2;

/**
 * Onramp.money's platform fee is not in its public price answer. Their merchant
 * guide gives 0.25% as the usual figure, and using it lands the estimate
 * slightly under what their page showed for the same amount. An estimate that
 * comes in low is the right way to be wrong.
 */
const PLATFORM_FEE_BASIS_POINTS = 25n;

const UNITS_PER_DOLLAR = 1_000_000n;

export type OnrampErrorCode = 'amount_too_small' | 'partner_unavailable';

export class OnrampError extends Error {
  readonly code: OnrampErrorCode;
  constructor(code: OnrampErrorCode) {
    super(code);
    this.name = 'OnrampError';
    this.code = code;
  }
}

/** What Onramp.money charges for naira right now, in integers. */
export type NairaPurchaseTerms = {
  /** Kobo for one USDC. */
  koboPerUsdc: bigint;
  /** Their payment gateway's cut of this purchase, in kobo. */
  gatewayFeeKobo: bigint;
  /** Taken off the payout, in USDC base units. */
  payoutFeeUnits: bigint;
  /** They will not pay out less than this, in USDC base units. */
  minimumPayoutUnits: bigint;
};

const decimalString = z.union([z.string(), z.number()]).transform((value) => String(value));

const termsResponseSchema = z.object({
  status: z.literal(1),
  data: z.object({
    price: z.number().positive(),
    gasFee: z.object({ withdrawalFee: decimalString, minimumWithdrawal: decimalString }),
    gatewayFee: z.object({ gatewayFee: z.number().nonnegative(), gatewayFeeFiat: z.number().nonnegative().optional() }),
  }),
});

/** "0.5" to 500000. Refuses anything that is not a plain decimal. */
function toUnits(decimal: string): bigint {
  const match = /^(\d+)(?:\.(\d{0,6})\d*)?$/.exec(decimal.trim());
  if (!match) throw new OnrampError('partner_unavailable');
  return BigInt(match[1]!) * UNITS_PER_DOLLAR + BigInt((match[2] ?? '').padEnd(6, '0'));
}

/** A naira figure with decimals, as kobo. */
function toKobo(naira: number): bigint {
  return BigInt(Math.round(naira * 100));
}

/** Whole naira only: the partner's page takes no kobo. */
export function wholeNairaKobo(payKobo: number): number {
  return Math.floor(payKobo / 100) * 100;
}

/**
 * Asks Onramp.money what `payKobo` of naira buys right now. Their public
 * endpoint, no key. The answer is parsed before anything reads it.
 */
export async function fetchNairaPurchaseTerms(
  payKobo: number,
  options: { apiBase?: string; fetch?: typeof fetch } = {},
): Promise<NairaPurchaseTerms> {
  const fetchImpl = options.fetch ?? fetch;
  const url = new URL('/onramp/api/v3/buy/public/coinDetails', options.apiBase ?? ONRAMP_MONEY_DEFAULT_API_BASE);
  url.searchParams.set('coinCode', 'usdc');
  url.searchParams.set('chainId', String(ONRAMP_MONEY_MONAD_CHAIN));
  url.searchParams.set('fiatAmount', String(wholeNairaKobo(payKobo) / 100));
  url.searchParams.set('fiatType', String(ONRAMP_MONEY_NAIRA));

  let body: unknown;
  try {
    const response = await fetchImpl(url.toString());
    if (!response.ok) throw new OnrampError('partner_unavailable');
    body = await response.json();
  } catch {
    throw new OnrampError('partner_unavailable');
  }
  const parsed = termsResponseSchema.safeParse(body);
  if (!parsed.success) throw new OnrampError('partner_unavailable');

  const { price, gasFee, gatewayFee } = parsed.data.data;
  return {
    koboPerUsdc: toKobo(price),
    gatewayFeeKobo: toKobo(gatewayFee.gatewayFeeFiat ?? gatewayFee.gatewayFee),
    payoutFeeUnits: toUnits(gasFee.withdrawalFee),
    minimumPayoutUnits: toUnits(gasFee.minimumWithdrawal),
  };
}

/**
 * About how much USDC the partner will pay out for `payKobo`, in base units.
 * An estimate: their page shows the final figure. Integer arithmetic only.
 * Throws `amount_too_small` when the payout would fall under their minimum.
 */
export function estimatePayoutUnits(payKobo: number, terms: NairaPurchaseTerms): bigint {
  const pay = BigInt(wholeNairaKobo(payKobo));
  const platformFee = (pay * PLATFORM_FEE_BASIS_POINTS + 9_999n) / 10_000n;
  const net = pay - terms.gatewayFeeKobo - platformFee;
  if (net <= 0n) throw new OnrampError('amount_too_small');
  const units = (net * UNITS_PER_DOLLAR) / terms.koboPerUsdc - terms.payoutFeeUnits;
  if (units < terms.minimumPayoutUnits) throw new OnrampError('amount_too_small');
  return units;
}

export type ConversionConfig = {
  /** The settlement asset the account holds. */
  settlementToken: Address;
  /** Where Relay returns the money if a conversion cannot be completed. One of
   * ours, so support can return it; never the holding address itself. */
  refundTo: Address;
  apiBase?: string;
  /** Optional. Relay answers without one, at a lower rate limit. */
  apiKey?: string;
  fetch?: typeof fetch;
};

const address = z
  .string()
  .refine((value) => isAddress(value, { strict: false }))
  .transform((value): Address => getAddress(value));

const conversionResponseSchema = z.object({
  steps: z.array(z.object({ depositAddress: address.optional() })).min(1),
  details: z.object({
    currencyOut: z.object({
      amount: z.string().regex(/^\d+$/),
      currency: z.object({ chainId: z.literal(ONRAMP_CHAIN_ID), address }),
    }),
  }),
});

/**
 * Asks Relay for a holding address: USDC sent to it on Monad arrives in
 * `recipient` as the settlement asset. Open-ended, so the amount that actually
 * lands is what gets converted; `amountUnits` only prices the estimate.
 */
export async function requestConversionAddress(
  input: { recipient: Address; amountUnits: bigint },
  config: ConversionConfig,
): Promise<{ depositAddress: Address; settlementUnits: bigint }> {
  const fetchImpl = config.fetch ?? fetch;
  let body: unknown;
  try {
    const response = await fetchImpl(`${(config.apiBase ?? RELAY_DEFAULT_API_BASE).replace(/\/$/, '')}/quote/v2`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(config.apiKey ? { 'x-api-key': config.apiKey } : {}) },
      body: JSON.stringify({
        user: input.recipient,
        recipient: input.recipient,
        originChainId: ONRAMP_CHAIN_ID,
        destinationChainId: ONRAMP_CHAIN_ID,
        originCurrency: MONAD_USDC,
        destinationCurrency: config.settlementToken,
        amount: input.amountUnits.toString(),
        tradeType: 'EXACT_INPUT',
        useDepositAddress: true,
        refundTo: config.refundTo,
      }),
    });
    if (!response.ok) throw new OnrampError('partner_unavailable');
    body = await response.json();
  } catch {
    throw new OnrampError('partner_unavailable');
  }

  const parsed = conversionResponseSchema.safeParse(body);
  if (!parsed.success) throw new OnrampError('partner_unavailable');
  const depositAddress = parsed.data.steps[0]!.depositAddress;
  const out = parsed.data.details.currencyOut;
  // A quote that would deliver some other asset is not one to send money into.
  if (!depositAddress || out.currency.address !== getAddress(config.settlementToken)) {
    throw new OnrampError('partner_unavailable');
  }
  return { depositAddress, settlementUnits: BigInt(out.amount) };
}

/**
 * The partner's page with everything filled in, so the person lands on the
 * payment step. `depositAddress` appears here and nowhere else.
 */
export function buildBankTransferUrl(input: {
  depositAddress: Address;
  payKobo: number;
  /** Ours, echoed back by the partner. Letters, digits, dashes. */
  reference: string;
  /** Where the partner sends the person afterwards. https only. */
  returnUrl: string;
  appId?: string;
  page?: string;
}): string {
  const back = new URL(input.returnUrl);
  if (back.protocol !== 'https:') throw new Error('The return address must be https');

  const url = new URL(input.page ?? ONRAMP_MONEY_DEFAULT_PAGE);
  url.searchParams.set('appId', input.appId ?? ONRAMP_MONEY_PUBLIC_APP_ID);
  url.searchParams.set('walletAddress', input.depositAddress);
  url.searchParams.set('coinCode', 'usdc');
  url.searchParams.set('network', 'monad');
  url.searchParams.set('fiatType', String(ONRAMP_MONEY_NAIRA));
  url.searchParams.set('fiatAmount', String(wholeNairaKobo(input.payKobo) / 100));
  url.searchParams.set('paymentMethod', String(ONRAMP_MONEY_BANK_TRANSFER));
  url.searchParams.set('merchantRecognitionId', input.reference);
  url.searchParams.set('redirectUrl', back.toString());
  return url.toString();
}

/** What the person is shown before they leave for the partner's page. */
export type BankTransferOffer = {
  /** The link to the partner's page. Open it; never print it. */
  url: string;
  /** What they pay, in kobo. Whole naira. */
  payMinor: number;
  /** About what arrives in the account, in kobo at the account's own rate. */
  arrivesMinor: number;
  /** Everything that does not arrive: both partners' fees and the partner's rate. */
  feeMinor: number;
};

/**
 * Prices a bank transfer and prepares the link for it. Nothing moves here: the
 * person still has to pay on the partner's page, and the balance changes only
 * when the money has actually arrived.
 */
export async function startBankTransfer(
  input: {
    recipient: Address;
    payKobo: number;
    /** The account's own rate, the one its balance is shown in. */
    koboPerDollar: number;
    reference: string;
    returnUrl: string;
  },
  config: ConversionConfig & { appId?: string; partnerApiBase?: string; partnerPage?: string },
): Promise<BankTransferOffer> {
  const payMinor = wholeNairaKobo(input.payKobo);
  if (payMinor <= 0) throw new OnrampError('amount_too_small');

  const terms = await fetchNairaPurchaseTerms(payMinor, {
    ...(config.partnerApiBase ? { apiBase: config.partnerApiBase } : {}),
    ...(config.fetch ? { fetch: config.fetch } : {}),
  });
  const payoutUnits = estimatePayoutUnits(payMinor, terms);
  const { depositAddress, settlementUnits } = await requestConversionAddress(
    { recipient: input.recipient, amountUnits: payoutUnits },
    config,
  );

  const arrivesMinor = Number((settlementUnits * BigInt(input.koboPerDollar)) / UNITS_PER_DOLLAR);
  // The partner's rate can never beat the account's own by enough to matter,
  // but a negative fee would be a lie on screen, so it is floored at nothing.
  const feeMinor = Math.max(0, payMinor - arrivesMinor);

  return {
    url: buildBankTransferUrl({
      depositAddress,
      payKobo: payMinor,
      reference: input.reference,
      returnUrl: input.returnUrl,
      ...(config.appId ? { appId: config.appId } : {}),
      ...(config.partnerPage ? { page: config.partnerPage } : {}),
    }),
    payMinor,
    arrivesMinor,
    feeMinor,
  };
}
