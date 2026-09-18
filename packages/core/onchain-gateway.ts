import type { Address, Hex, PublicClient, WalletClient } from 'viem';
import { keccak256, toHex } from 'viem';

import { toDollars, type Rate } from './fx';
import {
  demoGateway,
  FEE_MINOR,
  type AllowanceDraft,
  type PaymentsGateway,
  type SendInput,
} from './gateway';
import { kobo } from './money';
import {
  receiptSchema,
  snapshotSchema,
  type Allowance,
  type Cadence,
  type Receipt,
  type Snapshot,
} from './schemas';

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
  /** Everything the contract doesn't own — contacts, pots, the payment
   * request, and activity history. Until this is replaced by Envio
   * HyperIndex per docs/ARCHITECTURE.md ("do not read history directly from
   * RPC in the app"), it's the same fixture shape `demoGateway` uses; this
   * adapter only overlays live allowance state from the contract on top. */
  loadOffChainSnapshot: () => Promise<Snapshot>;
  cadenceSeconds?: Record<Cadence, bigint>;
};

function toTokenMinor(amountMinorNaira: number, config: OnChainGatewayConfig): bigint {
  const dollarsCents = toDollars(kobo(amountMinorNaira), config.rate);
  const scale = 10n ** BigInt(config.tokenDecimals - 2);
  return BigInt(dollarsCents) * scale;
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
          const tokenToNairaCents = Number(spentInPeriod) / 10 ** (config.tokenDecimals - 2);
          const spentMinor = Math.round((tokenToNairaCents * config.rate.koboPerDollar) / 100);
          const limitTokenToNairaCents = Number(periodCap) / 10 ** (config.tokenDecimals - 2);
          const limitMinor = Math.round((limitTokenToNairaCents * config.rate.koboPerDollar) / 100);
          return { ...a, spentMinor, limitMinor: limitMinor || a.limitMinor, paused: revoked || a.paused };
        }),
      );

      return snapshotSchema.parse({ ...base, allowances });
    },

    async submitPayment(input: SendInput): Promise<Receipt> {
      if (!input.allowanceId) {
        throw new Error(
          'On-chain gateway only settles proposals through an allowance today; a direct owner-initiated ' +
            'send needs its own owner-signed contract call, not yet wired here — see contracts/README.md.',
        );
      }

      const recipient = config.resolveRecipient(input.contactId);
      const amount = toTokenMinor(input.amountMinor, config);
      const id = toChainAllowanceId(input.allowanceId);

      const sentAt = new Date();
      const hash = await config.delegateWalletClient.writeContract({
        chain: config.delegateWalletClient.chain,
        account: config.delegateWalletClient.account!,
        address: config.policyAddress,
        abi: ENTOLE_POLICY_ABI,
        functionName: 'execute',
        args: [id, recipient, amount],
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
    settlePotShare: demoGateway.settlePotShare,
  };
}
