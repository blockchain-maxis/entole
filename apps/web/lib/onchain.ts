import { useMemo } from 'react';
import { createPublicClient, createWalletClient, http, type Address, type Chain, type WalletClient } from 'viem';

import { resolveContactId, resolveRecipient } from '@entole/core/address-book';
import { DEMO_RATE } from '@entole/core/fx';
import { demoGateway, type PaymentsGateway } from '@entole/core/gateway';
import { createOnChainGateway } from '@entole/core/onchain-gateway';
import type { EntoleKeyAccount } from '@entole/core/passkey';

import type { SignedInAccount } from './account';

const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_ENTOLE_POLICY_ADDRESS ??
  '0xd0c1099827e49C07f264927d0Dd3416eb29EA9b7') as Address;
const TOKEN_ADDRESS = (process.env.NEXT_PUBLIC_ENTOLE_TOKEN_ADDRESS ??
  '0xaca20A081Ab69148E291e65dcf4f69Ef9B0674A6') as Address;
/** Left unset until `GrowthVault` is deployed — see contracts/README.md's
 * Status section. `undefined` here is what makes `depositGrow`/`withdrawGrow`
 * fail loudly instead of pretending to settle. */
const GROWTH_VAULT_ADDRESS = process.env.NEXT_PUBLIC_ENTOLE_GROWTH_VAULT_ADDRESS
  ? (process.env.NEXT_PUBLIC_ENTOLE_GROWTH_VAULT_ADDRESS as Address)
  : undefined;
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? 'https://testnet-rpc.monad.xyz';
const CHAIN_ID = process.env.NEXT_PUBLIC_CHAIN_ID ? Number(process.env.NEXT_PUBLIC_CHAIN_ID) : 10143;
/** Empty until `indexer/` is actually running — see indexer/README.md. */
const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL || undefined;
/** `MockERC20` ("eUSD") decimals — see contracts/README.md. Update when
 * Agora AUSD or USDC replaces it (Phase 6). */
const TOKEN_DECIMALS = 6;

const monadTestnet: Chain = {
  id: CHAIN_ID,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};

/**
 * Never resolves `loadSnapshot`, rejects everything else. An honest "not
 * signed in yet" state for the brief window before an owner account exists
 * — not a fixture standing in for a real one. Nothing in the shipped app's
 * runtime reaches `demoGateway` once signed in.
 */
const pendingGateway: PaymentsGateway = {
  loadSnapshot: () => new Promise(() => {}),
  submitPayment: () => Promise.reject(new Error('Not signed in yet')),
  setPaused: () => Promise.reject(new Error('Not signed in yet')),
  saveAllowance: () => Promise.reject(new Error('Not signed in yet')),
  revokeAllowance: () => Promise.reject(new Error('Not signed in yet')),
  cancelProposal: () => Promise.reject(new Error('Not signed in yet')),
  saveSeat: () => Promise.reject(new Error('Not signed in yet')),
  revokeSeat: () => Promise.reject(new Error('Not signed in yet')),
  createInvoice: () => Promise.reject(new Error('Not signed in yet')),
  settleInvoice: () => Promise.reject(new Error('Not signed in yet')),
  requestConditionalRelease: () => Promise.reject(new Error('Not signed in yet')),
  createProcurementRequest: () => Promise.reject(new Error('Not signed in yet')),
  depositGrow: () => Promise.reject(new Error('Not signed in yet')),
  withdrawGrow: () => Promise.reject(new Error('Not signed in yet')),
  stocksAvailable: false,
  searchStocks: () => Promise.reject(new Error('Not signed in yet')),
  getStockQuote: () => Promise.reject(new Error('Not signed in yet')),
  buyStock: () => Promise.reject(new Error('Not signed in yet')),
  sellStock: () => Promise.reject(new Error('Not signed in yet')),
};

/** What the gateway needs to know about the assistant. Plain values plus one
 * stable function, so enabling it rebuilds the gateway at most once. */
export type AssistantForGateway = {
  enabled: boolean;
  address: Address | null;
  ensureKey: () => Promise<EntoleKeyAccount>;
};

/**
 * Builds the real `PaymentsGateway` once an owner account exists. Mirrors
 * `apps/mobile/lib/onchain.ts#useOnChainGateway` exactly — same config shape,
 * same `demoGateway.loadSnapshot`-backed off-chain metadata, only the config
 * source (env vars here, `expo-constants` there) differs. The assistant's key
 * is fetched lazily, only when an allowance-gated action needs it.
 */
export function useOnChainGateway(
  account: SignedInAccount | null,
  assistant: AssistantForGateway,
): PaymentsGateway {
  const owner = account?.owner ?? null;
  const { enabled, address, ensureKey } = assistant;

  return useMemo(() => {
    if (!owner) return pendingGateway;

    const publicClient = createPublicClient({ chain: monadTestnet, transport: http(RPC_URL) });
    const ownerWalletClient = createWalletClient({
      account: owner.viemAccount,
      chain: monadTestnet,
      transport: http(RPC_URL),
    });

    const delegate: { key?: EntoleKeyAccount; client?: WalletClient } = {};
    const getDelegateWalletClient = async (): Promise<WalletClient> => {
      const key = await ensureKey();
      if (!delegate.client || delegate.key !== key) {
        delegate.key = key;
        delegate.client = createWalletClient({
          account: key.viemAccount,
          chain: monadTestnet,
          transport: http(RPC_URL),
        });
      }
      return delegate.client;
    };

    return createOnChainGateway({
      publicClient,
      ownerWalletClient,
      ...(enabled && address ? { delegateAddress: address, getDelegateWalletClient } : {}),
      policyAddress: CONTRACT_ADDRESS,
      tokenAddress: TOKEN_ADDRESS,
      ...(GROWTH_VAULT_ADDRESS ? { growthVaultAddress: GROWTH_VAULT_ADDRESS } : {}),
      tokenDecimals: TOKEN_DECIMALS,
      rate: DEMO_RATE,
      resolveRecipient,
      loadOffChainSnapshot: demoGateway.loadSnapshot,
      ...(INDEXER_URL ? { indexerUrl: INDEXER_URL, resolveContactId } : {}),
    });
  }, [owner, enabled, address, ensureKey]);
}
