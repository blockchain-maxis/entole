import type { Address, Hex, PublicClient, WalletClient } from 'viem';
import { encodeAbiParameters, keccak256, parseEventLogs, parseSignature, toHex } from 'viem';

import { RateUnavailableError, toDollars, toNaira, type Rate } from './fx';
import {
  demoGateway,
  FEE_MINOR,
  type AllowanceDraft,
  type BillInput,
  type BillReceipt,
  type InvoiceDraft,
  type PaymentsGateway,
  type SeatDraft,
  type SendInput,
  type SendQuote,
} from './gateway';
import { evaluateReleaseCondition } from './chainlink-cre';
import { ASK_UNDO_SECONDS } from './assistant-ask';
import {
  counterpartyOf,
  fetchIndexedAllowanceIds,
  fetchIndexedPayments,
  mapPaymentToActivity,
  type IndexedPayment,
} from './indexed-activity';
import { invoiceSalt, saltPaysInvoice } from './invoice-tag';
import { nextInvoiceReference } from './invoices';
import { cents, kobo } from './money';
import type { ConfirmMovement, Movement } from './movement';
import { activityFromReceived, activityIdFor, paymentReference, type PaymentsFeed } from './payments-feed';
import type { Records } from './records';
import type { RelayClient, RelayPayment } from './relay-client';
import {
  growPositionSchema,
  invoiceSchema,
  receiptSchema,
  seatSchema,
  snapshotSchema,
  type Activity,
  type Allowance,
  type Cadence,
  type GrowPosition,
  type Invoice,
  type Proposal,
  type Receipt,
  type Seat,
  type Snapshot,
  type StockPosition,
  stockPositionSchema,
  DEFAULT_TAX_FRACTION,
  taxReserveSchema,
  type TaxReserve,
} from './schemas';
import {
  buyStock as brokerBuyStock,
  getQuote,
  listPositions,
  searchTicker,
  sellStock as brokerSellStock,
  type OrderResult,
  type StockBrokerConfig,
} from './stock-broker';

/**
 * The real `PaymentsGateway`. Swapping this in for `demoGateway` is the
 * one-file change docs/ARCHITECTURE.md promises — nothing in
 * `packages/core/store.tsx` or any screen changes when it happens, because
 * both implement the same interface from `gateway.ts`.
 *
 * This file talks to `contracts/src/EntolePolicy.sol` exactly as deployed.
 * If the ABI below drifts from that contract, every call here fails loudly
 * (a revert or a decode error), which is the correct failure mode — this
 * file must never guess what the contract will accept.
 */
export const ENTOLE_POLICY_ABI = [
  {
    type: 'function',
    name: 'createAllowance',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'bytes32' },
      { name: 'delegate', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'recipients', type: 'address[]' },
      { name: 'perRunMax', type: 'uint256' },
      { name: 'periodCap', type: 'uint256' },
      { name: 'periodSeconds', type: 'uint256' },
      { name: 'expiresAt', type: 'uint256' },
      { name: 'undoSeconds', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'propose',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'bytes32' },
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: 'runId', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'cancel',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'executePending',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'event',
    name: 'Proposed',
    inputs: [
      { name: 'runId', type: 'bytes32', indexed: true },
      { name: 'id', type: 'bytes32', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'readyAt', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'function',
    name: 'revoke',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setPaused',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'next', type: 'bool' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'bytes32' },
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'executeFor',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'bytes32' },
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'nonces',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'wouldExceed',
    stateMutability: 'view',
    inputs: [
      { name: 'id', type: 'bytes32' },
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'allowances',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [
      { name: 'owner', type: 'address' },
      { name: 'delegate', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'perRunMax', type: 'uint256' },
      { name: 'periodCap', type: 'uint256' },
      { name: 'periodSeconds', type: 'uint256' },
      { name: 'periodStart', type: 'uint256' },
      { name: 'spentInPeriod', type: 'uint256' },
      { name: 'expiresAt', type: 'uint256' },
      { name: 'revoked', type: 'bool' },
      { name: 'undoSeconds', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'paused',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

/** Minimal ERC20 fragment — a direct owner→contact send never touches the
 * policy contract at all. The owner's balance is never custodied by
 * `EntolePolicy` (it only ever draws against an `approve`), so a plain
 * transfer signed by the owner's own wallet client is the whole story. */
export const ERC20_ABI = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'eip712Domain',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'fields', type: 'bytes1' },
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
      { name: 'salt', type: 'bytes32' },
      { name: 'extensions', type: 'uint256[]' },
    ],
  },
] as const;

/** `EntoleRouter` — the fee is computed by the contract, so the app asks it
 * rather than repeating the schedule. */
export const ROUTER_ABI = [
  {
    type: 'function',
    name: 'feeFor',
    stateMutability: 'view',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [{ name: 'fee', type: 'uint256' }],
  },
] as const;

/** ERC-3009 `ReceiveWithAuthorization` — the one thing a person signs to send. */
const RECEIVE_WITH_AUTHORIZATION_TYPES = {
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

/** How long a signed payment stays valid if the server is slow. */
const AUTHORIZATION_WINDOW_SECONDS = 900;

/** `EntolePolicy.executeFor` — what the assistant's key signs so a sponsor can
 * submit the run. The domain is `EntolePolicy` / `1` on this chain and
 * contract; the signature commits to the allowance, recipient, amount, the
 * delegate's next nonce and a deadline. */
const EXECUTE_TYPES = {
  Execute: [
    { name: 'id', type: 'bytes32' },
    { name: 'recipient', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

/** `EntolePolicy.proposeFor`: the same commitments as `Execute`, for a run that waits out its undo window. */
const PROPOSE_TYPES = {
  Propose: [
    { name: 'id', type: 'bytes32' },
    { name: 'recipient', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

/** `EntolePolicy.cancelFor`: which run to stop, and until when the signature holds. */
const CANCEL_TYPES = {
  Cancel: [
    { name: 'runId', type: 'bytes32' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

/** Sponsor answers that settle the question: do not retry on the key's own fee. */
const DEFINITIVE_RELAY_CODES = new Set(['over_limit', 'insufficient_funds', 'rate_limited', 'gone', 'stale']);

/** How long a signed assistant run stays valid. */
const EXECUTE_WINDOW_SECONDS = 300;

/** A run in the contract's queue: which one, and when its undo window ends there. */
type WaitingRun = { runId: Hex; readyAtMs: number };

/** A run called a moment before the network's clock reaches it is asked for again, this often. */
const RUN_ATTEMPTS = 5;
const RUN_RETRY_MS = 1_500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** An allowance is created for 24 periods; the owner's standing approval to
 * the policy covers that whole horizon (one period for an on-request cap). */
const ALLOWANCE_PERIODS = 24n;

const REFUSED = {
  overOnePayment: "That's more than the assistant can spend in one payment.",
  overWhatIsLeft: "That's more than the assistant has left to spend.",
  paused: 'The assistant is paused. Resume it to continue.',
  turnedOff: 'That allowance has been turned off.',
  expired: 'That allowance has expired.',
  unknown: 'That payment is outside what the assistant can do right now.',
} as const;

/** Plain copy for what the contract can refuse. Never the raw error. */
const REVERT_MESSAGES: [RegExp, string][] = [
  [/OverPerRunMax/i, REFUSED.overOnePayment],
  [/OverPeriodCap/i, REFUSED.overWhatIsLeft],
  [/AccountPaused/i, REFUSED.paused],
  [/AlreadyRevoked/i, REFUSED.turnedOff],
  [/Expired|SignatureExpired/i, REFUSED.expired],
  [/RecipientNotAllowed/i, "The assistant can't pay that person."],
  [/TransferFailed|insufficient|balance/i, "You don't have enough for this payment."],
];

/**
 * Why the network would refuse the assistant a payment, in plain words.
 *
 * The contract's own check (`wouldExceed`) only answers yes or no. This reads
 * the same record the contract reads and walks it in the order the contract
 * does, so the person is told which rule held: the allowance was turned off,
 * the assistant is paused, the payment is over what one payment may be, or
 * over what is left for the period. It explains a refusal; it never makes one.
 */
export function whyRefused(
  allowance: {
    perRunMax: bigint;
    periodCap: bigint;
    periodSeconds: bigint;
    periodStart: bigint;
    spentInPeriod: bigint;
    expiresAt: bigint;
    revoked: boolean;
  },
  accountPaused: boolean,
  amountToken: bigint,
  nowSeconds: bigint,
): string {
  if (allowance.revoked) return REFUSED.turnedOff;
  if (accountPaused) return REFUSED.paused;
  if (nowSeconds > allowance.expiresAt) return REFUSED.expired;
  if (amountToken > allowance.perRunMax) return REFUSED.overOnePayment;
  // A period that has rolled over starts again from nothing spent.
  const spent = nowSeconds >= allowance.periodStart + allowance.periodSeconds ? 0n : allowance.spentInPeriod;
  if (spent + amountToken > allowance.periodCap) return REFUSED.overWhatIsLeft;
  return REFUSED.unknown;
}

/**
 * What one allowance can still draw from the owner, in token units: what is
 * left of the period it is in, as the contract would roll it, and the whole
 * cap of every period after that until it expires. Nothing for one that is
 * revoked or over. The owner's standing approval to the policy is the sum of
 * these, never more.
 */
export function remainingAuthorityOf(
  allowance: {
    periodCap: bigint;
    periodSeconds: bigint;
    periodStart: bigint;
    spentInPeriod: bigint;
    expiresAt: bigint;
    revoked: boolean;
  },
  nowSeconds: bigint,
): bigint {
  if (allowance.revoked || allowance.periodSeconds === 0n || nowSeconds > allowance.expiresAt) return 0n;
  let start = allowance.periodStart;
  let spent = allowance.spentInPeriod;
  if (nowSeconds >= start + allowance.periodSeconds) {
    start += ((nowSeconds - start) / allowance.periodSeconds) * allowance.periodSeconds;
    spent = 0n;
  }
  const thisPeriod = allowance.periodCap > spent ? allowance.periodCap - spent : 0n;
  const end = start + allowance.periodSeconds;
  const later =
    allowance.expiresAt >= end ? (allowance.expiresAt - end) / allowance.periodSeconds + 1n : 0n;
  return thisPeriod + later * allowance.periodCap;
}

/** A refusal in plain words; anything unrecognised stays generic. */
export function describeRevert(error: unknown): Error {
  const text = error instanceof Error ? `${error.name} ${(error as { shortMessage?: string }).shortMessage ?? ''} ${error.message}` : String(error);
  for (const [pattern, message] of REVERT_MESSAGES) if (pattern.test(text)) return new Error(message);
  return new Error("That payment didn't go through. Nothing was taken.");
}

/** `GrowthVault` — a separate contract from `EntolePolicy`, which never
 * custodies funds by design. Depositing/withdrawing your own "Grow" balance
 * is an owner action, same trust level as a direct send — no delegate, no
 * allowance, nothing the assistant can touch. */
export const GROWTH_VAULT_ABI = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

/**
 * A vault that pays: the standard ERC-4626 surface. On Monad mainnet this is
 * Aave's wrapped AUSD deposit, where the money is lent out and the interest
 * shows up as each share being worth more. The person's own account holds the
 * shares, so there is no balance of ours in between.
 */
export const SAVINGS_VAULT_ABI = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'redeem',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [{ name: 'assets', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'convertToAssets',
    stateMutability: 'view',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'maxWithdraw',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

/** Aave's data provider, for the one figure read from it: what depositors are
 * earning right now (`liquidityRate`, a yearly rate with 27 decimals). */
export const SAVINGS_RATE_ABI = [
  {
    type: 'function',
    name: 'getReserveData',
    stateMutability: 'view',
    inputs: [{ name: 'asset', type: 'address' }],
    outputs: [
      { name: 'unbacked', type: 'uint256' },
      { name: 'accruedToTreasuryScaled', type: 'uint256' },
      { name: 'totalAToken', type: 'uint256' },
      { name: 'totalStableDebt', type: 'uint256' },
      { name: 'totalVariableDebt', type: 'uint256' },
      { name: 'liquidityRate', type: 'uint256' },
      { name: 'variableBorrowRate', type: 'uint256' },
      { name: 'stableBorrowRate', type: 'uint256' },
      { name: 'averageStableBorrowRate', type: 'uint256' },
      { name: 'liquidityIndex', type: 'uint256' },
      { name: 'variableBorrowIndex', type: 'uint256' },
      { name: 'lastUpdateTimestamp', type: 'uint40' },
    ],
  },
] as const;

/** Raised when savings cannot be taken out because too much of the vault is
 * lent out at that moment. Plain copy: it is shown as-is. */
export class SavingsBusyError extends Error {
  constructor() {
    super("That much can't be taken out of savings right now. Try a smaller amount, or try again later.");
    this.name = 'SavingsBusyError';
  }
}

/** Deterministic bytes32 the contract uses to key an allowance, derived from
 * the app's own string id so both sides always agree without a lookup. */
export function toChainAllowanceId(appId: string): Hex {
  return keccak256(toHex(appId));
}

const SECONDS_PER_DAY = 86_400n;

/** 'on-request' never auto-resets — it's a lifetime cap until revoked and
 * recreated, not a recurring one. */
export const DEFAULT_CADENCE_SECONDS: Record<Cadence, bigint> = {
  weekly: 7n * SECONDS_PER_DAY,
  monthly: 30n * SECONDS_PER_DAY,
  'on-request': (2n ** 255n),
};

/** Raised by anything that needs the assistant's key when the person hasn't
 * turned the assistant on. The message is shown as-is, so it is plain copy. */
export class AssistantNotEnabledError extends Error {
  constructor() {
    super('Turn on the assistant first.');
    this.name = 'AssistantNotEnabledError';
  }
}

/** The config with a rate that is guaranteed present — the helpers below read
 * `config.rate` and must never see a missing one. */
type ResolvedConfig = Omit<OnChainGatewayConfig, 'rate'> & { rate: Rate };

export type OnChainGatewayConfig = {
  publicClient: PublicClient;
  /** Signs createAllowance / revoke / setPaused — the account the owner's
   * passkey ultimately authorises, directly or via a sponsored relay. */
  ownerWalletClient: WalletClient;
  /** Signs execute() only. Holds no funds; its authority is exactly what
   * the owner's `createAllowance` call granted it, nothing more. Optional:
   * the assistant is opt-in, so this is absent until the person turns it on
   * (and, after a restart, until `getDelegateWalletClient` derives it). */
  delegateWalletClient?: WalletClient;
  /** The assistant key's address, remembered from when it was approved, so
   * creating an allowance needs no passkey prompt. Falls back to
   * `delegateWalletClient`'s own account when that is present. */
  delegateAddress?: Address;
  /** Obtains the assistant's signing client on first need — derives the key
   * (one passkey prompt) and caches it in memory. Only reached when the
   * assistant is enabled; when it isn't, the app leaves this unset and every
   * assistant operation throws `AssistantNotEnabledError`. */
  getDelegateWalletClient?: () => Promise<WalletClient>;
  policyAddress: Address;
  tokenAddress: Address;
  /** `GrowthVault`'s address, once deployed — see contracts/README.md's
   * Status section. Left undefined until then; `depositGrow`/`withdrawGrow`
   * fail loudly rather than pretend to settle if it's missing. */
  growthVaultAddress?: Address;
  /** A vault that pays, in place of `growthVaultAddress`: Aave's wrapped AUSD
   * deposit on mainnet. Savings go into it straight from the person's own
   * account. `rateProvider` is Aave's data provider, read only for the rate
   * being earned; without it the balance still grows, and no rate is shown. */
  savingsVault?: { address: Address; rateProvider?: Address };
  /** Stocks broker credentials (Alpaca — see `stock-broker.ts`). Left
   * undefined, `stocksAvailable` is false and every stocks call throws that
   * module's "not configured" error. These are real secrets: the phone app
   * cannot hold them safely, so they belong to a server-side proxy — no app
   * wires this today, same disclosure as Agora/Aurora in `apps/web/.env`. */
  stockBroker?: StockBrokerConfig;
  /** Settlement token's on-chain decimals (6 for the demo eUSD and for
   * USDC; confirm against whatever Agora AUSD actually uses before
   * swapping it in). */
  tokenDecimals: number;
  /** A fixed rate — tests, or a caller with its own. The shipped apps pass
   * `getRate` instead and no fixed rate: there is no default to fall back on. */
  rate?: Rate;
  /** Live rate provider (see `createRateProvider`). Refreshed on every
   * snapshot load; with neither this nor `rate`, money operations refuse. */
  getRate?: () => Promise<Rate>;
  /** `EntoleRouter`, with `relay`: sends become one gasless signature, fee
   * charged by the contract. Left unset, a send is a plain transfer from the
   * owner's own account (which needs network-fee balance — tests and local
   * runs only). */
  routerAddress?: Address;
  relay?: Pick<RelayClient, 'submitPayment'> &
    Partial<
      Pick<
        RelayClient,
        | 'submitExecute'
        | 'submitPropose'
        | 'submitCancel'
        | 'submitRunPending'
        | 'validateBill'
        | 'submitBill'
        | 'prepareBringBack'
        | 'submitBringBack'
      >
    >;
  /** How long each of the assistant's runs waits on the network for the owner
   * to stop it, written into every allowance made here. */
  undoSeconds?: number;
  /** Policy contracts this account may have used before the current one. An
   * approval left on one is offered to be cleared (`clearOldApprovals`). */
  previousPolicyAddresses?: readonly Address[];
  /** The account bills are paid into, when bill payment is set up. A public
   * address like any other, never shown on a screen. Without it, and without
   * the relay's bill calls, `payBill` refuses. */
  billsRecipient?: Address;
  /** Tops up the owner's network-fee balance before an owner transaction. */
  ensureGas?: (owner: Address) => Promise<void>;
  /** Where sends, allowances and beneficiaries are kept on the device. */
  records?: Records;
  /** Off-UI address book: contact id → settlement address. Deliberately
   * never part of `Contact` or any schema a screen reads — the hard rule is
   * that an address must never reach the UI, and keeping resolution here
   * makes that structurally true rather than a convention to remember. */
  resolveRecipient: (contactId: string) => Address;
  /** Everything the contract doesn't own — contacts, the payment
   * request, and activity history. Serves as the activity fallback when
   * `indexerUrl` is unset or the indexer request fails — see
   * `loadSnapshot`'s comment below. */
  loadOffChainSnapshot: () => Promise<Snapshot>;
  /** The GraphQL address of the running index (`indexer/`). Set, the account's
   * payments are read from it on every load and whatever the device does not
   * have is written into its activity: history then follows the account, not
   * the phone. Unset, or out of reach, activity is what the device and the
   * server already know. This is docs/ARCHITECTURE.md's "do not read history
   * directly from RPC" rule, kept. */
  indexerUrl?: string;
  /** The name the directory has for an account, for someone met in the index
   * who is not saved on this device. Never the address back out to a screen. */
  nameOf?: (address: Address) => Promise<string | undefined>;
  /** The reverse of `resolveRecipient` — a payment read from the network
   * only carries an address, never the contact id a screen renders. It is
   * what lets a payment to or from someone already saved show under the name
   * they were saved as. */
  resolveContactId?: (address: Address) => string | undefined;
  /** Where a settled payment is reported so the person it was sent to sees it,
   * and where this account collects what has arrived for it. Without it a
   * payment still settles; the receiver's balance rises and nothing more. */
  payments?: PaymentsFeed;
  /** Drops the account's pending assistant proposal from its server inbox
   * once it has been run or cancelled, so the next snapshot read does not
   * surface it again. Unset when no inbox is configured — cancelling is then
   * the pure app-side action it has always been. */
  clearProposal?: () => Promise<void>;
  /** Called with the new allowance's id after one is created (and `null`
   * after one is revoked) so the server inbox knows which allowance the
   * assistant may charge. Best-effort: a failure
   * here never fails the change that already settled. */
  onAllowanceChanged?: (allowanceId: string | null) => Promise<void>;
  /**
   * Asked before the person moves their own money: a send, a bill, money into
   * or out of savings, a new allowance. The phone answers with its fingerprint
   * prompt, the browser with the passkey. It is called here, in the one place
   * every movement passes through, so no screen can move money without it.
   * The assistant's runs do not come this way: see `movement.ts`.
   */
  confirmMovement?: ConfirmMovement;
  cadenceSeconds?: Record<Cadence, bigint>;
};

/** Holdings from the broker, converted from its dollars into the account's
 * own currency at the same rate everything else here uses. */
async function loadStockPositions(config: ResolvedConfig): Promise<StockPosition[]> {
  const positions = await listPositions(config.stockBroker);
  return positions.map((p) =>
    stockPositionSchema.parse({
      symbol: p.symbol,
      companyName: p.companyName,
      quantityScaled: p.quantityScaled,
      costBasisMinor: toNaira(cents(p.costBasisCents), config.rate),
      currentValueMinor: toNaira(cents(p.marketValueCents), config.rate),
    }),
  );
}

/** A market order the broker has only queued (e.g. placed outside trading
 * hours) has not settled — say so rather than report a success that hasn't
 * happened yet. */
function requireFilled(order: OrderResult): void {
  if (order.status !== 'filled' && order.status !== 'partially_filled') {
    throw new Error(
      `Your order was received but hasn't filled yet (${order.status}). It will show under Holdings once the market fills it.`,
    );
  }
}

/**
 * An allowance's limit and what has been used of it, in naira, as a screen
 * shows them.
 *
 * The network holds the limit in dollars, to the cent. Read back through the
 * rate, a limit written as N2,000 comes out as N1,995.26, and moves again
 * whenever the rate does. So the limit shown is the one the person wrote, and
 * what has been used is the same share of it as it is of the limit the network
 * holds: half used there reads half used here, all of it reads nothing left.
 * What the network will actually allow is still decided there, in dollars.
 *
 * With no written figure (the device does not hold this allowance's record)
 * both figures come from the network, through the rate.
 */
export function allowanceFigures(
  writtenLimitMinor: number,
  periodCap: bigint,
  spentInPeriod: bigint,
  fromToken: (amount: bigint) => number,
): { limitMinor: number; spentMinor: number } {
  if (writtenLimitMinor <= 0 || periodCap <= 0n) {
    return { limitMinor: fromToken(periodCap) || writtenLimitMinor, spentMinor: fromToken(spentInPeriod) };
  }
  const share = Math.min(1, Number(spentInPeriod) / Number(periodCap));
  return { limitMinor: writtenLimitMinor, spentMinor: Math.round(writtenLimitMinor * share) };
}

function toTokenMinor(amountMinorNaira: number, config: ResolvedConfig): bigint {
  const dollarsCents = toDollars(kobo(amountMinorNaira), config.rate);
  const scale = 10n ** BigInt(config.tokenDecimals - 2);
  return BigInt(dollarsCents) * scale;
}

function fromTokenMinor(amountToken: bigint, config: ResolvedConfig): number {
  const tokenToNairaCents = Number(amountToken) / 10 ** (config.tokenDecimals - 2);
  return Math.round((tokenToNairaCents * config.rate.koboPerDollar) / 100);
}

/** The device's own records, or a plain refusal when there are none to keep them in. */
function requireRecords(config: ResolvedConfig): Records {
  if (!config.records) throw new Error("That can't be saved on this device yet.");
  return config.records;
}

/**
 * Where savings are kept, or a plain refusal when this build has nowhere to
 * keep them (no `GrowthVault` address configured; contracts/README.md's Status
 * section says where one is deployed). What is thrown can reach a screen, so
 * it is said the way the other refusals here are.
 */
function requireGrowthVaultAddress(config: ResolvedConfig): Address {
  if (!config.growthVaultAddress) throw new Error("Savings aren't available yet.");
  return config.growthVaultAddress;
}

/** Yearly rates from Aave carry 27 decimals; this is hundredths of a percent. */
const RAY_PER_BASIS_POINT = 10n ** 23n;

/**
 * Savings held in a vault that pays, read from the chain: what they are worth
 * now, how much of that is earnings (as far as this device knows what went
 * in), and the rate being earned. Nothing here is projected.
 */
async function earningSavingsPosition(
  config: ResolvedConfig,
  vault: NonNullable<OnChainGatewayConfig['savingsVault']>,
  owner: Address,
): Promise<GrowPosition> {
  const shares = await config.publicClient.readContract({
    address: vault.address,
    abi: SAVINGS_VAULT_ABI,
    functionName: 'balanceOf',
    args: [owner],
  });
  const value =
    shares === 0n
      ? 0n
      : await config.publicClient.readContract({
          address: vault.address,
          abi: SAVINGS_VAULT_ABI,
          functionName: 'convertToAssets',
          args: [shares],
        });

  const principal = (await config.records?.savings.principal()) ?? null;
  const earned = principal !== null && value > principal ? value - principal : 0n;

  // The rate is information beside the balance. If it cannot be read, the
  // balance is still true, and no rate is shown.
  let ratePerYearBps: number | undefined;
  if (vault.rateProvider) {
    try {
      const reserve = await config.publicClient.readContract({
        address: vault.rateProvider,
        abi: SAVINGS_RATE_ABI,
        functionName: 'getReserveData',
        args: [config.tokenAddress],
      });
      ratePerYearBps = Number(reserve[5] / RAY_PER_BASIS_POINT);
    } catch {
      ratePerYearBps = undefined;
    }
  }

  return growPositionSchema.parse({
    balanceMinor: fromTokenMinor(value, config),
    accruedMinor: fromTokenMinor(earned, config),
    nextPayoutAt: new Date().toISOString(),
    ...(ratePerYearBps !== undefined ? { ratePerYearBps } : {}),
  });
}

/** Re-reads the vault after a deposit/withdraw settles. `accruedMinor`/
 * `nextPayoutAt` stay whatever the off-chain snapshot already projects —
 * see `GrowthVault.sol`'s doc comment on why accrual is display-only. */
async function growthPositionAfterChange(
  config: ResolvedConfig,
  vaultAddress: Address,
): Promise<GrowPosition> {
  const base = await config.loadOffChainSnapshot();
  const balance = await config.publicClient.readContract({
    address: vaultAddress,
    abi: GROWTH_VAULT_ABI,
    functionName: 'balanceOf',
    args: [config.ownerWalletClient.account!.address],
  });
  return growPositionSchema.parse({
    accruedMinor: 0,
    nextPayoutAt: new Date().toISOString(),
    ...base.growPosition,
    balanceMinor: fromTokenMinor(balance, config),
  });
}

const newestFirst = (a: Activity, b: Activity) => Date.parse(b.at) - Date.parse(a.at);

/** A payment that arrived this recently is worth saying so out loud. Anything
 * older is history being caught up on, on a new device say, and is only listed. */
const ARRIVAL_IS_NEWS_MS = 15 * 60_000;

/**
 * Collects what has arrived for this account since the device last looked,
 * and writes it into the device's own activity, so an entry, once seen, is
 * there for good and never changes. Returns only the entries that were new.
 *
 * The amount is the naira figure the server stood behind when the payment
 * settled. Where it had none, it is worked out here, once, at today's rate.
 */
async function takeInArrivals(config: ResolvedConfig, known: Activity[]): Promise<Activity[]> {
  if (!config.payments || !config.records) return [];
  const received = await config.payments.list().catch(() => []);
  if (received.length === 0) return [];

  const have = new Set(known.map((entry) => entry.id));
  const entries = received.flatMap((payment) => {
    if (have.has(activityIdFor(payment.hash))) return [];
    const entry = activityFromReceived(payment, {
      savedContactId: config.resolveContactId?.(payment.from as Address),
      fallbackMinor: fromTokenMinor(BigInt(payment.amountToken), config),
    });
    return entry ? [entry] : [];
  });
  return config.records.activity.merge(entries).catch(() => []);
}

/** How many people met for the first time in one read of the index are looked up by name. */
const NAMES_PER_LOAD = 12;

/**
 * What the index knows of this account's payments that the device does not
 * have, written into the device's own activity. The index reads the payment
 * network itself, so it has what the device missed: everything, on a new
 * phone; and a payment whose sender's app closed before it could report it.
 *
 * Someone the device has not saved is named as the directory names them, a
 * few lookups at a time, and is an Entole account until then. Returns only
 * the entries that were new. An index that is unset, unreachable or wrong
 * returns nothing, and the list stays as it was.
 */
/**
 * Invoices paid without anyone marking them. A payment that arrived through
 * the router carrying an invoice's tag in its salt (`invoice-tag.ts`) marks
 * that invoice paid, when it is at least nine tenths of what was asked: the
 * rate moves between the asking and the paying. A payment that came another
 * way carries no tag, and that invoice is still marked by hand.
 */
async function settleTaggedInvoices(config: ResolvedConfig, owner: Address, payments: IndexedPayment[]): Promise<void> {
  const records = config.records;
  if (!records) return;
  const due = (await records.invoices.list()).filter(
    (invoice): invoice is typeof invoice & { reference: string } =>
      (invoice.status === 'sent' || invoice.status === 'pending-release') && Boolean(invoice.reference),
  );
  for (const invoice of due) {
    const paid = payments.find(
      (payment) =>
        payment.to.toLowerCase() === owner.toLowerCase() &&
        saltPaysInvoice(payment.salt, owner, invoice.reference) &&
        fromTokenMinor(BigInt(payment.amount), config) * 10 >= invoice.amountMinor * 9,
    );
    if (!paid) continue;
    const settled = invoiceSchema.parse({
      ...invoice,
      status: 'paid',
      paidAt: new Date(Number(paid.timestamp) * 1000).toISOString(),
      koboPerDollar: config.rate.koboPerDollar,
    });
    await records.invoices.upsert(settled);
    await setAsideForTax(records, settled, DEFAULT_TAX_FRACTION);
  }
}

/**
 * What a paid invoice sets aside for tax: a share of it, kept as a record, so
 * the business sees what it owes before it spends it. Earmarking only: no
 * money moves until the person moves it into savings, and no payout date is
 * made up for it. One per invoice.
 */
async function setAsideForTax(records: Records, invoice: Invoice, taxFraction: number): Promise<TaxReserve | null> {
  const share = Math.round(invoice.amountMinor * Math.min(Math.max(taxFraction, 0), 1));
  if (share <= 0) return null;
  const reserve = taxReserveSchema.parse({
    id: `tr-${invoice.id}`,
    name: `Tax on ${invoice.reference ?? invoice.clientName}`,
    balanceMinor: share,
    setAsideAt: invoice.paidAt ?? new Date().toISOString(),
    sourceInvoiceId: invoice.id,
  });
  await records.taxReserves.upsert(reserve);
  return reserve;
}

async function takeInIndexed(config: ResolvedConfig, owner: Address, known: Activity[]): Promise<Activity[]> {
  if (!config.indexerUrl || !config.records) return [];
  let payments;
  try {
    payments = await fetchIndexedPayments({ indexerUrl: config.indexerUrl, account: owner });
  } catch {
    return [];
  }

  await settleTaggedInvoices(config, owner, payments).catch(() => undefined);

  const have = new Set(known.map((entry) => entry.id));
  const missing = payments.filter((payment) => !have.has(activityIdFor(payment.txHash.toLowerCase())));
  if (missing.length === 0) return [];

  // People not saved on this device, named once each.
  const strangers = new Set<Address>();
  for (const payment of missing) {
    const other = counterpartyOf(payment, owner);
    if (other && !config.resolveContactId?.(other.address)) strangers.add(other.address);
  }
  const names = new Map<string, string>();
  await Promise.all(
    [...strangers].slice(0, NAMES_PER_LOAD).map(async (address) => {
      const name = await config.nameOf?.(address).catch(() => undefined);
      if (name) names.set(address.toLowerCase(), name);
    }),
  );

  const entries = missing.flatMap((payment) => {
    const entry = mapPaymentToActivity(payment, {
      account: owner,
      resolveContactId: config.resolveContactId,
      nameOf: (address) => names.get(address.toLowerCase()),
      tokenDecimals: config.tokenDecimals,
      rate: config.rate,
    });
    return entry ? [entry] : [];
  });
  return config.records.activity.merge(entries).catch(() => []);
}

/**
 * The account's activity: what this device sent, what arrived for it, and
 * whatever of either the index has that the device did not.
 *
 * Three sources, one list, and each payment in it once: they all call a
 * payment by the same id. What the server kept for this account is taken in
 * first, because it carries the sender's note and the figure they typed; the
 * index then fills in anything still missing. Everything taken in is written
 * to the device, so an entry, once seen, is there for good.
 */
async function loadActivity(
  config: ResolvedConfig,
  base: Snapshot,
  owner: Address,
): Promise<{ activity: Snapshot['activity']; arrived: Activity[] }> {
  const told = await takeInArrivals(config, base.activity);
  const afterTold = told.length > 0 ? [...told, ...base.activity].sort(newestFirst) : base.activity;
  const indexed = await takeInIndexed(config, owner, afterTold);
  const activity = indexed.length > 0 ? [...indexed, ...afterTold].sort(newestFirst) : afterTold;

  const now = Date.now();
  const arrived = [...told, ...indexed.filter((entry) => entry.direction === 'in')].filter(
    (entry) => now - Date.parse(entry.at) < ARRIVAL_IS_NEWS_MS,
  );
  return { activity, arrived };
}

export function createOnChainGateway(input: OnChainGatewayConfig): PaymentsGateway {
  const state: { rate: Rate | null } = { rate: input.rate ?? null };
  // Everything below reads `config.rate` and gets the latest one, or a plain
  // "can't reach the rate" refusal — never a stale fixture.
  const config: ResolvedConfig = {
    ...input,
    get rate(): Rate {
      if (!state.rate) throw new RateUnavailableError();
      return state.rate;
    },
  };

  async function refreshRate(): Promise<void> {
    if (input.getRate) state.rate = await input.getRate();
  }

  const ownerAddress = () => config.ownerWalletClient.account!.address;

  async function withGas(): Promise<void> {
    await config.ensureGas?.(ownerAddress());
  }

  /** The signing domain of the settlement token, read once. */
  let domain: { name: string; version: string; chainId: number; verifyingContract: Address } | undefined;
  async function tokenDomain() {
    if (!domain) {
      const [, name, version, chainId, verifyingContract] = await config.publicClient.readContract({
        address: config.tokenAddress,
        abi: ERC20_ABI,
        functionName: 'eip712Domain',
      });
      domain = { name, version, chainId: Number(chainId), verifyingContract };
    }
    return domain;
  }

  async function quote(amountMinor: number): Promise<SendQuote & { amountToken: bigint; feeToken: bigint }> {
    await refreshRate();
    const amountToken = toTokenMinor(amountMinor, config);
    if (amountToken <= 0n) throw new Error('Enter an amount to send.');
    if (!config.routerAddress) throw new Error("Sending isn't available yet.");
    const feeToken = await config.publicClient.readContract({
      address: config.routerAddress,
      abi: ROUTER_ABI,
      functionName: 'feeFor',
      args: [amountToken],
    });
    const feeMinor = fromTokenMinor(feeToken, config);
    return {
      amountMinor,
      feeMinor,
      totalMinor: amountMinor + feeMinor,
      receivesCents: Number(amountToken) / 10 ** (config.tokenDecimals - 2),
      rate: config.rate,
      amountToken,
      feeToken,
    };
  }

  /** One signature, ready to be submitted by the sponsor. The signature covers
   * exactly `amount + fee` to the router, and its nonce commits to the
   * recipient, amount and fee, so the server can submit it but not change it. */
  async function signRelayedPayment(
    amountMinor: number,
    recipient: Address,
    /** The invoice this pays, when it came from an invoice link: its tag goes in the salt. */
    reference?: string,
  ): Promise<{ payment: RelayPayment; feeMinor: number }> {
    const { amountToken, feeToken, feeMinor } = await quote(amountMinor);
    const owner = ownerAddress();

    const balance = await config.publicClient.readContract({
      address: config.tokenAddress,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [owner],
    });
    if (balance < amountToken + feeToken) {
      throw new Error("You don't have enough for this payment and its fee.");
    }

    const salt = reference ? invoiceSalt(recipient, reference) : toHex(crypto.getRandomValues(new Uint8Array(32)));
    const nonce = keccak256(
      encodeAbiParameters(
        [{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }],
        [recipient, amountToken, feeToken, salt],
      ),
    );
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + AUTHORIZATION_WINDOW_SECONDS);

    const signature = await config.ownerWalletClient.signTypedData({
      account: config.ownerWalletClient.account!,
      domain: await tokenDomain(),
      types: RECEIVE_WITH_AUTHORIZATION_TYPES,
      primaryType: 'ReceiveWithAuthorization',
      message: {
        from: owner,
        to: config.routerAddress!,
        value: amountToken + feeToken,
        validAfter: 0n,
        validBefore,
        nonce,
      },
    });
    const { r, s, v, yParity } = parseSignature(signature);

    return {
      payment: {
        from: owner,
        recipient,
        amount: amountToken,
        validAfter: 0n,
        validBefore,
        salt,
        v: Number(v ?? BigInt(27 + (yParity ?? 0))),
        r,
        s,
      },
      feeMinor,
    };
  }

  async function sendRelayed(
    amountMinor: number,
    recipient: Address,
    reference?: string,
  ): Promise<{ hash: Hex; feeMinor: number }> {
    const { payment, feeMinor } = await signRelayedPayment(amountMinor, recipient, reference);
    const hash = await config.relay!.submitPayment(payment);
    return { hash, feeMinor };
  }

  /** The run of payments the person last confirmed as one. */
  let confirmedBatch: string | null = null;

  /** Asks the person before their own money moves. With no way to ask (a test,
   * a script), nothing is asked: the apps always provide one. */
  async function confirm(movement: Movement): Promise<void> {
    await config.confirmMovement?.(movement);
  }

  /**
   * What every live allowance this owner holds on the policy can still draw,
   * in token units. The allowances are the ones this account has written down
   * and, where the index is running, the ones the network says it created, so
   * one made on another device is not missed. Each is read from the contract.
   */
  async function remainingAuthority(except?: Hex): Promise<bigint> {
    const ids = new Set<Hex>();
    for (const allowance of (await config.records?.allowances.list()) ?? []) ids.add(toChainAllowanceId(allowance.id));
    if (config.indexerUrl) {
      const indexed = await fetchIndexedAllowanceIds({ indexerUrl: config.indexerUrl, owner: ownerAddress() }).catch(
        () => [] as Hex[],
      );
      for (const id of indexed) ids.add(id);
    }
    if (except) ids.delete(except);

    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
    const me = ownerAddress().toLowerCase();
    let total = 0n;
    for (const id of ids) {
      const [owner, , , , periodCap, periodSeconds, periodStart, spentInPeriod, expiresAt, revoked] =
        await config.publicClient.readContract({
          address: config.policyAddress,
          abi: ENTOLE_POLICY_ABI,
          functionName: 'allowances',
          args: [id],
        });
      if (owner.toLowerCase() !== me) continue;
      total += remainingAuthorityOf({ periodCap, periodSeconds, periodStart, spentInPeriod, expiresAt, revoked }, nowSeconds);
    }
    return total;
  }

  /**
   * Sets the policy's standing approval to exactly what the live allowances
   * can still draw, plus `extraToken` for one about to be written. The
   * approval is replaced, not added to, so revoking an allowance lowers it.
   */
  async function setStandingApproval(extraToken: bigint, except?: Hex): Promise<void> {
    const wanted = (await remainingAuthority(except)) + extraToken;
    const current = await config.publicClient.readContract({
      address: config.tokenAddress,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [ownerAddress(), config.policyAddress],
    });
    if (current === wanted) return;
    const hash = await config.ownerWalletClient.writeContract({
      chain: config.ownerWalletClient.chain,
      account: config.ownerWalletClient.account!,
      address: config.tokenAddress,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [config.policyAddress, wanted],
    });
    await config.publicClient.waitForTransactionReceipt({ hash });
  }

  async function notifyAllowanceChanged(allowanceId: string | null): Promise<void> {
    await config.onAllowanceChanged?.(allowanceId).catch(() => undefined);
  }

  /** Which rule the network would refuse a run under, read from its own record. */
  async function refusalReason(id: Hex, amountToken: bigint): Promise<string> {
    try {
      const [owner, , , perRunMax, periodCap, periodSeconds, periodStart, spentInPeriod, expiresAt, revoked] =
        await config.publicClient.readContract({
          address: config.policyAddress,
          abi: ENTOLE_POLICY_ABI,
          functionName: 'allowances',
          args: [id],
        });
      const accountPaused = await config.publicClient.readContract({
        address: config.policyAddress,
        abi: ENTOLE_POLICY_ABI,
        functionName: 'paused',
        args: [owner],
      });
      return whyRefused(
        { perRunMax, periodCap, periodSeconds, periodStart, spentInPeriod, expiresAt, revoked },
        accountPaused === true,
        amountToken,
        BigInt(Math.floor(Date.now() / 1000)),
      );
    } catch {
      return REFUSED.unknown;
    }
  }

  /** The assistant spends inside an allowance. The assistant's key only signs;
   * the sponsor pays the network fee. Falls back to the key paying for itself
   * (topped up first) when the sponsor route is not there. */
  async function executeAsAssistant(allowanceId: string, recipient: Address, amountToken: bigint): Promise<Hex> {
    const delegate = await delegateClient();
    const delegateAccount = delegate.account!;
    const id = toChainAllowanceId(allowanceId);

    const refused = await config.publicClient.readContract({
      address: config.policyAddress,
      abi: ENTOLE_POLICY_ABI,
      functionName: 'wouldExceed',
      args: [id, recipient, amountToken],
    });
    if (refused === true) throw new Error(await refusalReason(id, amountToken));

    if (config.relay?.submitExecute) {
      try {
        const nonce = await config.publicClient.readContract({
          address: config.policyAddress,
          abi: ENTOLE_POLICY_ABI,
          functionName: 'nonces',
          args: [delegateAccount.address],
        });
        const deadline = BigInt(Math.floor(Date.now() / 1000) + EXECUTE_WINDOW_SECONDS);
        const signature = await delegate.signTypedData({
          account: delegateAccount,
          domain: {
            name: 'EntolePolicy',
            version: '1',
            chainId: delegate.chain?.id ?? (await config.publicClient.getChainId()),
            verifyingContract: config.policyAddress,
          },
          types: EXECUTE_TYPES,
          primaryType: 'Execute',
          message: { id, recipient, amount: amountToken, nonce: nonce ?? 0n, deadline },
        });
        return await config.relay.submitExecute({ id, recipient, amount: amountToken, deadline, signature });
      } catch (error) {
        // A definite answer (over the cap, not enough funds, too many tries) is
        // the answer. Anything else (no sponsor route, or a policy contract
        // from before `executeFor` that has no nonce to read) means this path
        // is not available, so the key pays for itself below.
        const code = (error as { code?: string }).code;
        if (code && DEFINITIVE_RELAY_CODES.has(code)) throw error;
      }
    }

    await config.ensureGas?.(delegateAccount.address);
    try {
      return await delegate.writeContract({
        chain: delegate.chain,
        account: delegateAccount,
        address: config.policyAddress,
        abi: ENTOLE_POLICY_ABI,
        functionName: 'execute',
        args: [id, recipient, amountToken],
      });
    } catch (error) {
      throw describeRevert(error);
    }
  }

  /** The assistant's runs waiting out their undo window, by the proposal they came from. */
  const waitingRuns = new Map<string, WaitingRun>();

  async function policyDomain(client: WalletClient) {
    return {
      name: 'EntolePolicy',
      version: '1',
      chainId: client.chain?.id ?? (await config.publicClient.getChainId()),
      verifyingContract: config.policyAddress,
    } as const;
  }

  /**
   * The assistant puts a run in the contract's queue. Every rule is checked
   * now and the amount is held back against the allowance; nothing moves
   * until the run's undo window has passed. Its key only signs; the sponsor
   * pays the fee, or the key pays for itself where there is no sponsor.
   */
  async function proposeAsAssistant(allowanceId: string, recipient: Address, amountToken: bigint): Promise<WaitingRun> {
    const delegate = await delegateClient();
    const delegateAccount = delegate.account!;
    const id = toChainAllowanceId(allowanceId);

    const refused = await config.publicClient.readContract({
      address: config.policyAddress,
      abi: ENTOLE_POLICY_ABI,
      functionName: 'wouldExceed',
      args: [id, recipient, amountToken],
    });
    if (refused === true) throw new Error(await refusalReason(id, amountToken));

    let hash: Hex | null = null;
    if (config.relay?.submitPropose) {
      try {
        const nonce = await config.publicClient.readContract({
          address: config.policyAddress,
          abi: ENTOLE_POLICY_ABI,
          functionName: 'nonces',
          args: [delegateAccount.address],
        });
        const deadline = BigInt(Math.floor(Date.now() / 1000) + EXECUTE_WINDOW_SECONDS);
        const signature = await delegate.signTypedData({
          account: delegateAccount,
          domain: await policyDomain(delegate),
          types: PROPOSE_TYPES,
          primaryType: 'Propose',
          message: { id, recipient, amount: amountToken, nonce: nonce ?? 0n, deadline },
        });
        hash = await config.relay.submitPropose({ id, recipient, amount: amountToken, deadline, signature });
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code && DEFINITIVE_RELAY_CODES.has(code)) throw error;
      }
    }
    if (!hash) {
      await config.ensureGas?.(delegateAccount.address);
      try {
        hash = await delegate.writeContract({
          chain: delegate.chain,
          account: delegateAccount,
          address: config.policyAddress,
          abi: ENTOLE_POLICY_ABI,
          functionName: 'propose',
          args: [id, recipient, amountToken],
        });
      } catch (error) {
        throw describeRevert(error);
      }
    }

    const receipt = await config.publicClient.waitForTransactionReceipt({ hash });
    const proposed = parseEventLogs({ abi: ENTOLE_POLICY_ABI, logs: receipt.logs, eventName: 'Proposed' })[0];
    if (receipt.status !== 'success' || !proposed) {
      throw new Error("The assistant couldn't start that payment. Nothing was sent.");
    }
    return { runId: proposed.args.runId, readyAtMs: Number(proposed.args.readyAt) * 1000 };
  }

  /**
   * Carries out a run once its undo window has passed on the network. The
   * network's clock can trail this device's by a moment, so a run it calls too
   * early is asked for again shortly.
   */
  async function runWhenReady(run: WaitingRun): Promise<Hex> {
    const wait = run.readyAtMs - Date.now();
    if (wait > 0) await sleep(wait);
    for (let attempt = 1; ; attempt += 1) {
      try {
        if (config.relay?.submitRunPending) return await config.relay.submitRunPending(run.runId);
        const delegate = await delegateClient();
        await config.ensureGas?.(delegate.account!.address);
        return await delegate.writeContract({
          chain: delegate.chain,
          account: delegate.account!,
          address: config.policyAddress,
          abi: ENTOLE_POLICY_ABI,
          functionName: 'executePending',
          args: [run.runId],
        });
      } catch (error) {
        const code = (error as { code?: string }).code;
        const early = code === 'too_early' || /TooEarly/.test(String((error as Error)?.message ?? error));
        if (!early || attempt >= RUN_ATTEMPTS) throw code ? error : describeRevert(error);
        await sleep(RUN_RETRY_MS);
      }
    }
  }

  /** Stops a waiting run on the network, signed by the assistant's own key. */
  async function cancelRun(run: WaitingRun): Promise<void> {
    const delegate = await delegateClient();
    let hash: Hex | null = null;
    if (config.relay?.submitCancel) {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + EXECUTE_WINDOW_SECONDS);
      const signature = await delegate.signTypedData({
        account: delegate.account!,
        domain: await policyDomain(delegate),
        types: CANCEL_TYPES,
        primaryType: 'Cancel',
        message: { runId: run.runId, deadline },
      });
      try {
        hash = await config.relay.submitCancel({ runId: run.runId, deadline, signature });
      } catch (error) {
        // Already stopped or already gone: there is nothing left to stop.
        if ((error as { code?: string }).code === 'gone') return;
      }
    }
    if (!hash) {
      await config.ensureGas?.(delegate.account!.address);
      try {
        hash = await delegate.writeContract({
          chain: delegate.chain,
          account: delegate.account!,
          address: config.policyAddress,
          abi: ENTOLE_POLICY_ABI,
          functionName: 'cancel',
          args: [run.runId],
        });
      } catch (error) {
        if (/NoSuchRun/.test(String((error as Error)?.message ?? error))) return;
        throw new Error("We couldn't stop it on the network. Pause the assistant now to be sure it does not go.");
      }
    }
    const receipt = await config.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') {
      throw new Error("We couldn't stop it on the network. Pause the assistant now to be sure it does not go.");
    }
  }

  const cadenceSeconds = config.cadenceSeconds ?? DEFAULT_CADENCE_SECONDS;
  const delegateAddress = config.delegateAddress ?? config.delegateWalletClient?.account?.address;

  /** What the person's savings in a paying vault are worth right now. */
  async function earningSavingsValue(vault: Address, saver: Address): Promise<bigint> {
    const shares = await config.publicClient.readContract({
      address: vault,
      abi: SAVINGS_VAULT_ABI,
      functionName: 'balanceOf',
      args: [saver],
    });
    if (shares === 0n) return 0n;
    return config.publicClient.readContract({
      address: vault,
      abi: SAVINGS_VAULT_ABI,
      functionName: 'convertToAssets',
      args: [shares],
    });
  }

  /** How long an allowance makes each run wait, as the contract has it. */
  async function undoSecondsOf(allowanceId: string): Promise<bigint> {
    const record = await config.publicClient.readContract({
      address: config.policyAddress,
      abi: ENTOLE_POLICY_ABI,
      functionName: 'allowances',
      args: [toChainAllowanceId(allowanceId)],
    });
    return record[10];
  }

  /** The assistant's signing client, or a clear refusal when it is not on. */
  async function delegateClient(): Promise<WalletClient> {
    if (config.delegateWalletClient) return config.delegateWalletClient;
    if (config.getDelegateWalletClient) return config.getDelegateWalletClient();
    throw new AssistantNotEnabledError();
  }

  return {
    async loadSnapshot() {
      await refreshRate();
      const base = await config.loadOffChainSnapshot();
      const owner = ownerAddress();

      const [balanceToken, paused] = await Promise.all([
        config.publicClient.readContract({
          address: config.tokenAddress,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [owner],
        }),
        config.publicClient.readContract({
          address: config.policyAddress,
          abi: ENTOLE_POLICY_ABI,
          functionName: 'paused',
          args: [owner],
        }),
      ]);

      const allowances = await Promise.all(
        base.allowances.map(async (a): Promise<Allowance> => {
          const id = toChainAllowanceId(a.id);
          const onchain = await config.publicClient.readContract({
            address: config.policyAddress,
            abi: ENTOLE_POLICY_ABI,
            functionName: 'allowances',
            args: [id],
          });
          const [allowanceOwner, , , , periodCap, , , spentInPeriod, , revoked] = onchain;
          const { limitMinor, spentMinor } = allowanceFigures(a.limitMinor, periodCap, spentInPeriod, (amount) =>
            fromTokenMinor(amount, config),
          );
          // One written on a policy this account no longer uses does not exist
          // on this one: it is shown stopped until it is written again.
          const missing = allowanceOwner.toLowerCase() !== owner.toLowerCase();
          return { ...a, spentMinor, limitMinor, paused: revoked || missing || a.paused };
        }),
      );

      const growPosition = config.savingsVault
        ? await earningSavingsPosition(config, config.savingsVault, owner)
        : config.growthVaultAddress
        ? growPositionSchema.parse({
            accruedMinor: 0,
            nextPayoutAt: new Date().toISOString(),
            ...base.growPosition,
            balanceMinor: fromTokenMinor(
              await config.publicClient.readContract({
                address: config.growthVaultAddress,
                abi: GROWTH_VAULT_ABI,
                functionName: 'balanceOf',
                args: [owner],
              }),
              config,
            ),
          })
        : base.growPosition;

      const { activity, arrived } = await loadActivity(config, base, owner);

      // An approval left on a policy this account used before is worth clearing.
      const oldPolicyApproval = (
        await Promise.all(
          (config.previousPolicyAddresses ?? []).map((policy) =>
            config.publicClient
              .readContract({ address: config.tokenAddress, abi: ERC20_ABI, functionName: 'allowance', args: [owner, policy] })
              .catch(() => 0n),
          ),
        )
      ).some((left) => left > 0n);

      // Real holdings when a broker is configured; the (empty) off-chain
      // default otherwise. A failed broker request degrades to that default
      // rather than failing the whole snapshot — Holdings then reads empty
      // until the next successful load.
      const stockPositions = config.stockBroker
        ? await loadStockPositions(config).catch(() => base.stockPositions)
        : base.stockPositions;

      return snapshotSchema.parse({
        ...base,
        // The balance is what the account really holds, in the account's
        // currency at the live rate — not whatever the off-chain records say.
        account: {
          ...base.account,
          balanceMinor: fromTokenMinor(balanceToken, config),
          koboPerDollar: config.rate.koboPerDollar,
          paused,
        },
        allowances,
        activity,
        // Read again: an invoice the index just showed paid is paid on this screen too.
        ...(config.records ? { invoices: await config.records.invoices.list() } : {}),
        ...(arrived.length > 0 ? { arrived } : {}),
        ...(oldPolicyApproval ? { oldPolicyApproval } : {}),
        growPosition,
        stockPositions,
      });
    },

    async quoteSend(amountMinor: number): Promise<SendQuote> {
      const { amountToken: _amountToken, feeToken: _feeToken, ...publicQuote } = await quote(amountMinor);
      return publicQuote;
    },

    async submitPayment(input: SendInput): Promise<Receipt> {
      // The person's own send is confirmed first. The assistant's run is not:
      // the allowance is its limit and the undo window is the person's check.
      if (!input.allowanceId) {
        if (input.batch) {
          if (confirmedBatch !== input.batch.id) {
            await confirm({ kind: 'send-many', totalMinor: input.batch.totalMinor, count: input.batch.count });
            confirmedBatch = input.batch.id;
          }
        } else {
          await confirm({ kind: 'send', amountMinor: input.amountMinor });
        }
      }
      await refreshRate();
      const recipient = config.resolveRecipient(input.contactId);
      const sentAt = new Date();
      const allowanceId = input.allowanceId;
      const relayed = !allowanceId && Boolean(config.routerAddress && config.relay);

      let hash: Hex;
      let feeMinor: number = FEE_MINOR;
      if (allowanceId) {
        const amountToken = toTokenMinor(input.amountMinor, config);
        const waiting = input.proposalId ? waitingRuns.get(input.proposalId) : undefined;
        if (waiting) {
          // Started when the person was shown it: its window is over now.
          hash = await runWhenReady(waiting);
          waitingRuns.delete(input.proposalId!);
        } else if ((await undoSecondsOf(allowanceId)) > 0n) {
          // Not started yet: it goes into the queue now and waits its window out.
          hash = await runWhenReady(await proposeAsAssistant(allowanceId, recipient, amountToken));
        } else {
          hash = await executeAsAssistant(allowanceId, recipient, amountToken);
        }
      } else if (relayed) {
        const sent = await sendRelayed(input.amountMinor, recipient, input.reference);
        hash = sent.hash;
        feeMinor = sent.feeMinor;
      } else {
        hash = await config.ownerWalletClient.writeContract({
          chain: config.ownerWalletClient.chain,
          account: config.ownerWalletClient.account!,
          address: config.tokenAddress,
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [recipient, toTokenMinor(input.amountMinor, config)],
        });
      }

      const settledReceipt = await config.publicClient.waitForTransactionReceipt({ hash });
      if (settledReceipt.status && settledReceipt.status !== 'success') {
        throw new Error("That payment didn't go through. Nothing was taken.");
      }
      const settledAt = new Date();
      const deliveredInSeconds = Math.max(1, Math.round((settledAt.getTime() - sentAt.getTime()) / 1000));

      const receipt = receiptSchema.parse({
        id: `rc-${settledReceipt.transactionHash}`,
        reference: paymentReference(settledReceipt.transactionHash),
        contactId: input.contactId,
        amountMinor: input.amountMinor,
        feeMinor,
        receivedMinor: Math.round((input.amountMinor * 100) / config.rate.koboPerDollar),
        koboPerDollar: config.rate.koboPerDollar,
        sentAt: sentAt.toISOString(),
        settledAt: settledAt.toISOString(),
        deliveredInSeconds,
      });

      // Only a settled payment is ever written down.
      await config.records?.activity
        .add({
          id: receipt.id,
          contactId: input.contactId,
          note: input.note ?? 'Sent',
          at: receipt.settledAt,
          amountMinor: input.amountMinor,
          direction: 'out',
          initiatedBy: allowanceId ? 'assistant' : 'you',
          state: 'settled',
          ...(allowanceId ? { allowanceId } : {}),
        })
        .catch(() => undefined);

      // Tell the server it settled, so the person it was sent to sees it in
      // their activity and is told it arrived. Not waited on: the payment is
      // done whether or not this gets through, and the receipt should not
      // wait for it.
      void config.payments
        ?.record({
          hash: settledReceipt.transactionHash,
          ...(input.note ? { note: input.note } : {}),
          amountMinor: input.amountMinor,
          koboPerDollar: config.rate.koboPerDollar,
        })
        .catch(() => undefined);

      return receipt;
    },

    async setPaused(paused: boolean): Promise<void> {
      await withGas();
      const hash = await config.ownerWalletClient.writeContract({
        chain: config.ownerWalletClient.chain,
        account: config.ownerWalletClient.account!,
        address: config.policyAddress,
        abi: ENTOLE_POLICY_ABI,
        functionName: 'setPaused',
        args: [paused],
      });
      await config.publicClient.waitForTransactionReceipt({ hash });
    },

    async saveAllowance(draft: AllowanceDraft): Promise<Allowance> {
      if (!delegateAddress) throw new AssistantNotEnabledError();
      // An allowance is permission to move money later, so it is confirmed like a movement.
      await confirm({ kind: 'allowance', limitMinor: draft.limitMinor });
      const appId = draft.id ?? `a-${Date.now()}`;
      const id = toChainAllowanceId(appId);
      const recipient = config.resolveRecipient(draft.recipientId);
      const seconds = cadenceSeconds[draft.cadence];
      await withGas();
      const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
      // 24 periods out, then it must be renewed. An on-request cap has no
      // period to multiply (its "period" is effectively forever), so it lasts
      // a year instead.
      const onRequest = draft.cadence === 'on-request';
      // It ends the second before a 25th period would begin, so 24 periods are exactly 24 caps.
      const expiresAt = nowSeconds + (onRequest ? 365n * SECONDS_PER_DAY : seconds * ALLOWANCE_PERIODS - 1n);

      // The policy can only draw what the owner has approved, so approve first:
      // an allowance that exists but cannot pay would fail on its first use.
      // The approval is set to exactly what the other allowances can still
      // draw plus what this one can, never added on top of whatever was there.
      const capToken = toTokenMinor(draft.limitMinor, config);
      await setStandingApproval(
        remainingAuthorityOf(
          { periodCap: capToken, periodSeconds: seconds, periodStart: nowSeconds, spentInPeriod: 0n, expiresAt, revoked: false },
          nowSeconds,
        ),
        id,
      );

      const hash = await config.ownerWalletClient.writeContract({
        chain: config.ownerWalletClient.chain,
        account: config.ownerWalletClient.account!,
        address: config.policyAddress,
        abi: ENTOLE_POLICY_ABI,
        functionName: 'createAllowance',
        args: [
          id,
          delegateAddress,
          config.tokenAddress,
          [recipient],
          toTokenMinor(draft.perRunMinor, config),
          toTokenMinor(draft.limitMinor, config),
          seconds,
          expiresAt,
          BigInt(config.undoSeconds ?? ASK_UNDO_SECONDS),
        ],
      });
      await config.publicClient.waitForTransactionReceipt({ hash });

      const saved: Allowance = {
        id: appId,
        name: draft.name,
        recipientId: draft.recipientId,
        limitMinor: draft.limitMinor,
        spentMinor: 0,
        perRunMinor: draft.perRunMinor,
        cadence: draft.cadence,
        resetsAt: new Date(Number(onRequest ? expiresAt : nowSeconds + seconds) * 1000).toISOString(),
        paused: false,
      };
      await config.records?.allowances.upsert(saved);
      await notifyAllowanceChanged(appId);
      return saved;
    },

    async revokeAllowance(allowanceId: string): Promise<void> {
      await withGas();
      const id = toChainAllowanceId(allowanceId);
      const hash = await config.ownerWalletClient.writeContract({
        chain: config.ownerWalletClient.chain,
        account: config.ownerWalletClient.account!,
        address: config.policyAddress,
        abi: ENTOLE_POLICY_ABI,
        functionName: 'revoke',
        args: [id],
      });
      await config.publicClient.waitForTransactionReceipt({ hash });
      await config.records?.allowances.remove(allowanceId);
      // What it could have drawn is no longer approved. Best-effort: the
      // revocation already stops every draw, the approval is only headroom.
      await setStandingApproval(0n, id).catch(() => undefined);
      await notifyAllowanceChanged(null);
    },

    async validateBill(input) {
      const validate = config.relay?.validateBill;
      if (!validate) throw new Error("Paying bills isn't available yet.");
      return validate(input);
    },

    async payBill(input: BillInput): Promise<BillReceipt> {
      const submit = config.relay?.submitBill;
      if (!submit || !config.billsRecipient || !config.routerAddress) {
        throw new Error("Paying bills isn't available yet.");
      }
      await confirm({ kind: 'bill', amountMinor: input.amountMinor });
      await refreshRate();
      // One signature moves the money to the bills account. The server pays the
      // biller only after that payment has settled, and answers only after the
      // biller has answered: nothing here is shown as paid before then.
      const { payment } = await signRelayedPayment(input.amountMinor, config.billsRecipient);
      const paid = await submit(payment, input);
      return { reference: paid.reference, status: paid.status };
    },

    async depositGrow(amountMinor: number) {
      await confirm({ kind: 'save', amountMinor });
      if (config.savingsVault) {
        const vault = config.savingsVault;
        const saver = ownerAddress();
        await refreshRate();
        const amount = toTokenMinor(amountMinor, config);
        if (amount <= 0n) throw new Error('Enter an amount to save.');
        await withGas();

        // What is already there, before this goes in: on a device that never
        // saw it go in, it all counts as the person's own money from here on.
        const before = await earningSavingsValue(vault.address, saver);
        const principal = (await config.records?.savings.principal()) ?? before;

        const approved = await config.publicClient.readContract({
          address: config.tokenAddress,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [saver, vault.address],
        });
        if (approved < amount) {
          const approval = await config.ownerWalletClient.writeContract({
            chain: config.ownerWalletClient.chain,
            account: config.ownerWalletClient.account!,
            address: config.tokenAddress,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [vault.address, amount],
          });
          await config.publicClient.waitForTransactionReceipt({ hash: approval });
        }

        const hash = await config.ownerWalletClient.writeContract({
          chain: config.ownerWalletClient.chain,
          account: config.ownerWalletClient.account!,
          address: vault.address,
          abi: SAVINGS_VAULT_ABI,
          functionName: 'deposit',
          args: [amount, saver],
        });
        await config.publicClient.waitForTransactionReceipt({ hash });
        await config.records?.savings.setPrincipal(principal + amount);
        return earningSavingsPosition(config, vault, saver);
      }

      const vaultAddress = requireGrowthVaultAddress(config);
      await refreshRate();
      const amount = toTokenMinor(amountMinor, config);
      if (amount <= 0n) throw new Error('Enter an amount to save.');
      await withGas();

      // The vault pulls the money with `transferFrom`, so it must be approved
      // for at least this amount first. Only asks when the current approval
      // doesn't already cover it.
      const approved = await config.publicClient.readContract({
        address: config.tokenAddress,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [ownerAddress(), vaultAddress],
      });
      if (approved < amount) {
        const approval = await config.ownerWalletClient.writeContract({
          chain: config.ownerWalletClient.chain,
          account: config.ownerWalletClient.account!,
          address: config.tokenAddress,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [vaultAddress, amount],
        });
        await config.publicClient.waitForTransactionReceipt({ hash: approval });
      }

      const hash = await config.ownerWalletClient.writeContract({
        chain: config.ownerWalletClient.chain,
        account: config.ownerWalletClient.account!,
        address: vaultAddress,
        abi: GROWTH_VAULT_ABI,
        functionName: 'deposit',
        args: [amount],
      });
      await config.publicClient.waitForTransactionReceipt({ hash });
      return growthPositionAfterChange(config, vaultAddress);
    },

    async withdrawGrow(amountMinor: number) {
      await confirm({ kind: 'take-out', amountMinor });
      if (config.savingsVault) {
        const vault = config.savingsVault;
        const saver = ownerAddress();
        await refreshRate();
        const amount = toTokenMinor(amountMinor, config);
        if (amount <= 0n) throw new Error('Enter an amount to take out.');

        const shares = await config.publicClient.readContract({
          address: vault.address,
          abi: SAVINGS_VAULT_ABI,
          functionName: 'balanceOf',
          args: [saver],
        });
        const value = await earningSavingsValue(vault.address, saver);
        // Naira in, dollars out: asking for "all of it" can land a hair over
        // what is there. That means all of it.
        const everything = amount >= value;
        const taking = everything ? value : amount;

        // If too much of the vault is lent out, say so before anything is signed.
        const available = await config.publicClient.readContract({
          address: vault.address,
          abi: SAVINGS_VAULT_ABI,
          functionName: 'maxWithdraw',
          args: [saver],
        });
        if (taking > available) throw new SavingsBusyError();

        await withGas();
        const hash = everything
          ? await config.ownerWalletClient.writeContract({
              chain: config.ownerWalletClient.chain,
              account: config.ownerWalletClient.account!,
              address: vault.address,
              abi: SAVINGS_VAULT_ABI,
              functionName: 'redeem',
              args: [shares, saver, saver],
            })
          : await config.ownerWalletClient.writeContract({
              chain: config.ownerWalletClient.chain,
              account: config.ownerWalletClient.account!,
              address: vault.address,
              abi: SAVINGS_VAULT_ABI,
              functionName: 'withdraw',
              args: [amount, saver, saver],
            });
        await config.publicClient.waitForTransactionReceipt({ hash });

        // Taking part out takes the same part of what went in, so what is
        // left keeps its share of the earnings.
        const principal = (await config.records?.savings.principal()) ?? null;
        if (principal !== null) {
          await config.records?.savings.setPrincipal(
            everything || value === 0n ? 0n : (principal * (value - taking)) / value,
          );
        }
        return earningSavingsPosition(config, vault, saver);
      }

      const vaultAddress = requireGrowthVaultAddress(config);
      const amount = toTokenMinor(amountMinor, config);
      await withGas();
      const hash = await config.ownerWalletClient.writeContract({
        chain: config.ownerWalletClient.chain,
        account: config.ownerWalletClient.account!,
        address: vaultAddress,
        abi: GROWTH_VAULT_ABI,
        functionName: 'withdraw',
        args: [amount],
      });
      await config.publicClient.waitForTransactionReceipt({ hash });
      return growthPositionAfterChange(config, vaultAddress);
    },

    stocksAvailable: Boolean(config.stockBroker?.apiKeyId && config.stockBroker.apiSecretKey),

    async searchStocks(query: string) {
      const results = await searchTicker(query, config.stockBroker);
      return results.map(({ symbol, name }) => ({ symbol, name }));
    },

    async getStockQuote(symbol: string) {
      const quote = await getQuote(symbol, config.stockBroker);
      return {
        symbol: quote.symbol,
        priceMinor: toNaira(cents(quote.midPriceCents), config.rate),
        asOf: quote.asOf,
      };
    },

    async buyStock(symbol: string, quantityScaled: number) {
      requireFilled(await brokerBuyStock(symbol, quantityScaled, config.stockBroker));
      return loadStockPositions(config);
    },

    async sellStock(symbol: string, quantityScaled: number) {
      requireFilled(await brokerSellStock(symbol, quantityScaled, config.stockBroker));
      return loadStockPositions(config);
    },

    async beginProposal(proposal: Proposal): Promise<{ readyAt: string }> {
      const known = waitingRuns.get(proposal.id);
      if (known) return { readyAt: new Date(known.readyAtMs).toISOString() };
      await refreshRate();
      const run = await proposeAsAssistant(
        proposal.allowanceId,
        config.resolveRecipient(proposal.contactId),
        toTokenMinor(proposal.amountMinor, config),
      );
      waitingRuns.set(proposal.id, run);
      return { readyAt: new Date(run.readyAtMs).toISOString() };
    },

    async cancelProposal(proposalId?: string): Promise<void> {
      // A run already in the contract's queue is stopped there, where it
      // counts: cancelled on the network, it can never be carried out. A
      // failure to stop it is said, not swallowed.
      const waiting = proposalId ? waitingRuns.get(proposalId) : undefined;
      if (waiting) {
        await cancelRun(waiting);
        waitingRuns.delete(proposalId!);
      }
      // The server inbox copy goes too, so a cancelled (or already-run)
      // proposal does not re-surface on the next read. Best-effort.
      await config.clearProposal?.().catch(() => undefined);
    },

    async clearOldApprovals(): Promise<void> {
      for (const policy of config.previousPolicyAddresses ?? []) {
        const left = await config.publicClient.readContract({
          address: config.tokenAddress,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [ownerAddress(), policy],
        });
        if (left === 0n) continue;
        await withGas();
        const hash = await config.ownerWalletClient.writeContract({
          chain: config.ownerWalletClient.chain,
          account: config.ownerWalletClient.account!,
          address: config.tokenAddress,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [policy, 0n],
        });
        await config.publicClient.waitForTransactionReceipt({ hash });
      }
    },

    // A seat is the business's own record of what a person on the team may
    // spend: kept on the device like beneficiaries and invoices, and back on the
    // next load. It is a record, not an on-chain grant: there is no second
    // account for a team member to sign with, so the contract cannot enforce it
    // (docs/BACKLOG.md). Editing keeps what the seat has already spent.
    async saveSeat(draft: SeatDraft): Promise<Seat> {
      const records = requireRecords(config);
      const existing = draft.id ? (await records.seats.list()).find((seat) => seat.id === draft.id) : undefined;
      const nowSeconds = Math.floor(Date.now() / 1000);
      const periodSeconds =
        draft.cadence === 'on-request' ? 365n * SECONDS_PER_DAY : cadenceSeconds[draft.cadence];
      const seat = seatSchema.parse({
        id: draft.id ?? `s-${Date.now()}`,
        name: draft.name,
        contactId: draft.contactId,
        role: draft.role,
        limitMinor: draft.limitMinor,
        spentMinor: existing?.spentMinor ?? 0,
        perRunMinor: draft.perRunMinor,
        cadence: draft.cadence,
        resetsAt: new Date((nowSeconds + Number(periodSeconds)) * 1000).toISOString(),
        paused: existing?.paused ?? false,
      });
      await records.seats.upsert(seat);
      return seat;
    },

    async revokeSeat(seatId: string): Promise<void> {
      await requireRecords(config).seats.remove(seatId);
    },

    // Invoices are the business's own records, kept on the device like
    // beneficiaries. There is no second settlement path: a client pays the
    // invoice's checkout link and the money arrives in the balance.
    async createInvoice(draft: InvoiceDraft): Promise<Invoice> {
      const records = requireRecords(config);
      const existing = await records.invoices.list();
      const reference = draft.reference?.trim() || nextInvoiceReference(existing);
      if (existing.some((entry) => entry.reference === reference)) {
        throw new Error(`Invoice ${reference} already exists. Go back and try again.`);
      }
      const invoice = invoiceSchema.parse({
        id: `inv-${Date.now()}`,
        reference,
        clientName: draft.clientName.trim(),
        amountMinor: draft.amountMinor,
        note: draft.note.trim(),
        dueAt: draft.dueAt,
        status: draft.releaseCondition ? 'pending-release' : 'sent',
        link: draft.link ?? '',
        ...(draft.releaseCondition ? { releaseCondition: draft.releaseCondition } : {}),
      });
      await records.invoices.upsert(invoice);
      return invoice;
    },

    /** A manual mark: it records that the client paid. Nothing here watches the
     * balance, and no tax reserve is invented — that stays `null`. */
    async settleInvoice(
      invoiceId: string,
      taxFraction = DEFAULT_TAX_FRACTION,
    ): Promise<{ invoice: Invoice; taxReserve: TaxReserve | null }> {
      const records = requireRecords(config);
      const found = (await records.invoices.list()).find((entry) => entry.id === invoiceId);
      if (!found) throw new Error("We couldn't find that invoice.");
      if (found.status === 'paid') return { invoice: found, taxReserve: null };
      const invoice = invoiceSchema.parse({
        ...found,
        status: 'paid',
        paidAt: new Date().toISOString(),
        koboPerDollar: config.rate.koboPerDollar,
      });
      await records.invoices.upsert(invoice);
      return { invoice, taxReserve: await setAsideForTax(records, invoice, taxFraction) };
    },

    async bringBackHeld(source: 'tron-usdt' | 'solana-usdc'): Promise<void> {
      if (!config.relay?.prepareBringBack || !config.relay.submitBringBack) throw new Error("This isn't available yet.");
      const owner = ownerAddress();
      const { intent, units } = await config.relay.prepareBringBack(owner, source);
      await refreshRate();
      // Both are dollars with six decimals, as the account's own money is.
      await confirm({ kind: 'bring-in', amountMinor: fromTokenMinor(BigInt(units), config) });
      // The person's own key signs the exact intent written for them, as any Ethereum wallet signs a message.
      const signature = await config.ownerWalletClient.signMessage({
        account: config.ownerWalletClient.account!,
        message: intent.payload,
      });
      await config.relay.submitBringBack(owner, intent, signature);
    },

    async markTaxReservesMoved(ids: string[]): Promise<TaxReserve[]> {
      const records = requireRecords(config);
      const movedAt = new Date().toISOString();
      for (const reserve of await records.taxReserves.list()) {
        if (ids.includes(reserve.id) && !reserve.movedAt) await records.taxReserves.upsert({ ...reserve, movedAt });
      }
      return records.taxReserves.list();
    },

    // Chainlink-gated release stays gated as it was: it needs the CRE workflow.
    // A held invoice is one of the business's own records. Checking it reads
    // that record, not sample data, and releasing it only changes what the
    // record says: from held to waiting to be paid.
    async requestConditionalRelease(invoiceId: string, observedRate: Rate) {
      const records = requireRecords(config);
      const found = (await records.invoices.list()).find((entry) => entry.id === invoiceId);
      if (!found) throw new Error("We couldn't find that invoice.");
      if (found.status !== 'pending-release' || !found.releaseCondition) return { invoice: found, taxReserve: null };
      if (!evaluateReleaseCondition(found.releaseCondition, observedRate)) return null;
      const invoice = invoiceSchema.parse({ ...found, status: 'sent' });
      await records.invoices.upsert(invoice);
      return { invoice, taxReserve: null };
    },
    // No screen creates a supply request any more; the method is left as it was.
    createProcurementRequest: demoGateway.createProcurementRequest,
  };
}
