import type { Address, Hex, PublicClient, WalletClient } from 'viem';
import { encodeAbiParameters, keccak256, parseSignature, toHex } from 'viem';

import { RateUnavailableError, toDollars, toNaira, type Rate } from './fx';
import {
  demoGateway,
  FEE_MINOR,
  type AllowanceDraft,
  type PaymentsGateway,
  type SendInput,
  type SendQuote,
} from './gateway';
import { fetchIndexedActivity } from './indexed-activity';
import { cents, kobo } from './money';
import type { Records } from './records';
import type { RelayClient } from './relay-client';
import {
  growPositionSchema,
  receiptSchema,
  snapshotSchema,
  type Allowance,
  type Cadence,
  type GrowPosition,
  type Receipt,
  type Snapshot,
  type StockPosition,
  stockPositionSchema,
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
    ],
    outputs: [],
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
  relay?: Pick<RelayClient, 'submitPayment'>;
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
  /** Envio HyperIndex's GraphQL endpoint, once `indexer/` is actually
   * running (see `indexer/README.md` — needs an `ENVIO_API_TOKEN` this repo
   * doesn't have committed anywhere). Left undefined, `loadSnapshot` uses
   * `loadOffChainSnapshot`'s activity as it always has. Set, it tries the
   * indexer first and only falls back on a failed/empty response — this is
   * docs/ARCHITECTURE.md's "do not read history directly from RPC" rule,
   * satisfied for real once the indexer is up. */
  indexerUrl?: string;
  /** The reverse of `resolveRecipient` — an indexed on-chain event only
   * carries an address, never the contact id a screen renders. Required
   * whenever `indexerUrl` is set. */
  resolveContactId?: (address: Address) => string | undefined;
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

function toTokenMinor(amountMinorNaira: number, config: ResolvedConfig): bigint {
  const dollarsCents = toDollars(kobo(amountMinorNaira), config.rate);
  const scale = 10n ** BigInt(config.tokenDecimals - 2);
  return BigInt(dollarsCents) * scale;
}

function fromTokenMinor(amountToken: bigint, config: ResolvedConfig): number {
  const tokenToNairaCents = Number(amountToken) / 10 ** (config.tokenDecimals - 2);
  return Math.round((tokenToNairaCents * config.rate.koboPerDollar) / 100);
}

function requireGrowthVaultAddress(config: ResolvedConfig): Address {
  if (!config.growthVaultAddress) {
    throw new Error(
      'GrowthVault is not deployed yet on this network — see contracts/README.md\'s Status section.',
    );
  }
  return config.growthVaultAddress;
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

/** Indexed history when `indexerUrl` is configured and reachable; the
 * off-chain snapshot's activity otherwise — the one pre-existing fallback
 * path, never a second fabricated source. A failed/unreachable indexer
 * degrades to that fallback rather than failing the whole snapshot load. */
async function loadActivity(
  config: ResolvedConfig,
  base: Snapshot,
  allowances: Allowance[],
): Promise<Snapshot['activity']> {
  if (!config.indexerUrl || !config.resolveContactId) return base.activity;

  try {
    return await fetchIndexedActivity({
      indexerUrl: config.indexerUrl,
      resolveContactId: config.resolveContactId,
      knownAllowances: allowances,
      tokenDecimals: config.tokenDecimals,
      rate: config.rate,
    });
  } catch {
    return base.activity;
  }
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

  /** One signature, sent through the sponsor. The signature covers exactly
   * `amount + fee` to the router, and its nonce commits to the recipient,
   * amount and fee — so the server can submit it but not change it. */
  async function sendRelayed(amountMinor: number, recipient: Address): Promise<{ hash: Hex; feeMinor: number }> {
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

    const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
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

    const hash = await config.relay!.submitPayment({
      from: owner,
      recipient,
      amount: amountToken,
      validAfter: 0n,
      validBefore,
      salt,
      v: Number(v ?? BigInt(27 + (yParity ?? 0))),
      r,
      s,
    });
    return { hash, feeMinor };
  }

  const cadenceSeconds = config.cadenceSeconds ?? DEFAULT_CADENCE_SECONDS;
  const delegateAddress = config.delegateAddress ?? config.delegateWalletClient?.account?.address;

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
          const [, , , , periodCap, , , spentInPeriod, , revoked] = onchain;
          const spentMinor = fromTokenMinor(spentInPeriod, config);
          const limitMinor = fromTokenMinor(periodCap, config);
          return { ...a, spentMinor, limitMinor: limitMinor || a.limitMinor, paused: revoked || a.paused };
        }),
      );

      const growPosition = config.growthVaultAddress
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

      const activity = await loadActivity(config, base, allowances);

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
        growPosition,
        stockPositions,
      });
    },

    async quoteSend(amountMinor: number): Promise<SendQuote> {
      const { amountToken: _amountToken, feeToken: _feeToken, ...publicQuote } = await quote(amountMinor);
      return publicQuote;
    },

    async submitPayment(input: SendInput): Promise<Receipt> {
      await refreshRate();
      const recipient = config.resolveRecipient(input.contactId);
      const sentAt = new Date();
      const allowanceId = input.allowanceId;
      const relayed = !allowanceId && Boolean(config.routerAddress && config.relay);

      let hash: Hex;
      let feeMinor: number = FEE_MINOR;
      if (allowanceId) {
        const delegate = await delegateClient();
        hash = await delegate.writeContract({
          chain: delegate.chain,
          account: delegate.account!,
          address: config.policyAddress,
          abi: ENTOLE_POLICY_ABI,
          functionName: 'execute',
          args: [toChainAllowanceId(allowanceId), recipient, toTokenMinor(input.amountMinor, config)],
        });
      } else if (relayed) {
        const sent = await sendRelayed(input.amountMinor, recipient);
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
        reference: settledReceipt.transactionHash.slice(2, 14).toUpperCase(),
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
      const appId = draft.id ?? `a-${Date.now()}`;
      const id = toChainAllowanceId(appId);
      const recipient = config.resolveRecipient(draft.recipientId);
      const seconds = cadenceSeconds[draft.cadence];
      await withGas();
      const expiresAt = BigInt(Math.floor(Date.now() / 1000)) + seconds * 24n; // 24 periods out, then must be renewed

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
        resetsAt: new Date(Number(expiresAt / 24n) * 1000).toISOString(),
        paused: false,
      };
      await config.records?.allowances.upsert(saved);
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
    },

    async depositGrow(amountMinor: number) {
      const vaultAddress = requireGrowthVaultAddress(config);
      const amount = toTokenMinor(amountMinor, config);
      await withGas();
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

    async cancelProposal(): Promise<void> {
      // Nothing on-chain to undo: the undo window is exactly the promise
      // that `execute` is never called until it expires. Cancelling is a
      // pure app/backend-side action — see docs/PRODUCT.md's "undo window,
      // never a confirmation dialog."
    },

    // The business layer (seats, invoicing, tax reserve) is record-keeping
    // and UI composition on top of the same allowance primitive, not a
    // second settlement path — a seat's actual spending power is an
    // allowance like any other, created via `saveAllowance` above. Nothing
    // here needs its own contract call yet, so these stay on the same demo
    // records everything else in `loadOffChainSnapshot` provides, until
    // seats/invoices get their own indexed backing store.
    saveSeat: demoGateway.saveSeat,
    revokeSeat: demoGateway.revokeSeat,
    createInvoice: demoGateway.createInvoice,
    settleInvoice: demoGateway.settleInvoice,
    requestConditionalRelease: demoGateway.requestConditionalRelease,
    createProcurementRequest: demoGateway.createProcurementRequest,
  };
}
