import type { Address, Hex, PublicClient, WalletClient } from 'viem';
import { keccak256, toHex } from 'viem';

import { toDollars, toNaira, type Rate } from './fx';
import {
  demoGateway,
  FEE_MINOR,
  type AllowanceDraft,
  type PaymentsGateway,
  type SendInput,
} from './gateway';
import { fetchIndexedActivity } from './indexed-activity';
import { cents, kobo } from './money';
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
] as const;

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

export type OnChainGatewayConfig = {
  publicClient: PublicClient;
  /** Signs createAllowance / revoke / setPaused — the account the owner's
   * passkey ultimately authorises, directly or via a sponsored relay. */
  ownerWalletClient: WalletClient;
  /** Signs execute() only. Holds no funds; its authority is exactly what
   * the owner's `createAllowance` call granted it, nothing more. */
  delegateWalletClient: WalletClient;
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
  rate: Rate;
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
async function loadStockPositions(config: OnChainGatewayConfig): Promise<StockPosition[]> {
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

function toTokenMinor(amountMinorNaira: number, config: OnChainGatewayConfig): bigint {
  const dollarsCents = toDollars(kobo(amountMinorNaira), config.rate);
  const scale = 10n ** BigInt(config.tokenDecimals - 2);
  return BigInt(dollarsCents) * scale;
}

function fromTokenMinor(amountToken: bigint, config: OnChainGatewayConfig): number {
  const tokenToNairaCents = Number(amountToken) / 10 ** (config.tokenDecimals - 2);
  return Math.round((tokenToNairaCents * config.rate.koboPerDollar) / 100);
}

function requireGrowthVaultAddress(config: OnChainGatewayConfig): Address {
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
  config: OnChainGatewayConfig,
  vaultAddress: Address,
): Promise<GrowPosition> {
  const base = await config.loadOffChainSnapshot();
  const balance = await config.publicClient.readContract({
    address: vaultAddress,
    abi: GROWTH_VAULT_ABI,
    functionName: 'balanceOf',
    args: [config.ownerWalletClient.account!.address],
  });
  return growPositionSchema.parse({ ...base.growPosition, balanceMinor: fromTokenMinor(balance, config) });
}

/** Indexed history when `indexerUrl` is configured and reachable; the
 * off-chain snapshot's activity otherwise — the one pre-existing fallback
 * path, never a second fabricated source. A failed/unreachable indexer
 * degrades to that fallback rather than failing the whole snapshot load. */
async function loadActivity(
  config: OnChainGatewayConfig,
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

export function createOnChainGateway(config: OnChainGatewayConfig): PaymentsGateway {
  const cadenceSeconds = config.cadenceSeconds ?? DEFAULT_CADENCE_SECONDS;
  const delegateAddress = config.delegateWalletClient.account?.address;
  if (!delegateAddress) throw new Error('delegateWalletClient must have an account attached');

  return {
    async loadSnapshot() {
      const base = await config.loadOffChainSnapshot();

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
        ? {
            ...base.growPosition,
            balanceMinor: fromTokenMinor(
              await config.publicClient.readContract({
                address: config.growthVaultAddress,
                abi: GROWTH_VAULT_ABI,
                functionName: 'balanceOf',
                args: [config.ownerWalletClient.account!.address],
              }),
              config,
            ),
          }
        : base.growPosition;

      const activity = await loadActivity(config, base, allowances);

      // Real holdings when a broker is configured; the (empty) off-chain
      // default otherwise. A failed broker request degrades to that default
      // rather than failing the whole snapshot — Holdings then reads empty
      // until the next successful load.
      const stockPositions = config.stockBroker
        ? await loadStockPositions(config).catch(() => base.stockPositions)
        : base.stockPositions;

      return snapshotSchema.parse({ ...base, allowances, activity, growPosition, stockPositions });
    },

    async submitPayment(input: SendInput): Promise<Receipt> {
      const recipient = config.resolveRecipient(input.contactId);
      const amount = toTokenMinor(input.amountMinor, config);

      const sentAt = new Date();
      const hash = input.allowanceId
        ? await config.delegateWalletClient.writeContract({
            chain: config.delegateWalletClient.chain,
            account: config.delegateWalletClient.account!,
            address: config.policyAddress,
            abi: ENTOLE_POLICY_ABI,
            functionName: 'execute',
            args: [toChainAllowanceId(input.allowanceId), recipient, amount],
          })
        : await config.ownerWalletClient.writeContract({
            chain: config.ownerWalletClient.chain,
            account: config.ownerWalletClient.account!,
            address: config.tokenAddress,
            abi: ERC20_ABI,
            functionName: 'transfer',
            args: [recipient, amount],
          });

      const settledReceipt = await config.publicClient.waitForTransactionReceipt({ hash });
      const settledAt = new Date();
      const deliveredInSeconds = Math.max(1, Math.round((settledAt.getTime() - sentAt.getTime()) / 1000));

      return receiptSchema.parse({
        id: `rc-${settledReceipt.transactionHash}`,
        reference: settledReceipt.transactionHash.slice(2, 14).toUpperCase(),
        contactId: input.contactId,
        amountMinor: input.amountMinor,
        feeMinor: FEE_MINOR,
        receivedMinor: Math.round((input.amountMinor * 100) / config.rate.koboPerDollar),
        koboPerDollar: config.rate.koboPerDollar,
        sentAt: sentAt.toISOString(),
        settledAt: settledAt.toISOString(),
        deliveredInSeconds,
      });
    },

    async setPaused(paused: boolean): Promise<void> {
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
      const appId = draft.id ?? `a-${Date.now()}`;
      const id = toChainAllowanceId(appId);
      const recipient = config.resolveRecipient(draft.recipientId);
      const seconds = cadenceSeconds[draft.cadence];
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

      return {
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
    },

    async revokeAllowance(allowanceId: string): Promise<void> {
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
    },

    async depositGrow(amountMinor: number) {
      const vaultAddress = requireGrowthVaultAddress(config);
      const amount = toTokenMinor(amountMinor, config);
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
