import Constants from 'expo-constants';
import { useMemo } from 'react';
import { createPublicClient, createWalletClient, http, type Address, type Chain, type WalletClient } from 'viem';

import { createAccountSource } from '@entole/core/account-snapshot';
import { createRateProvider } from '@entole/core/fx';
import { pendingBackend, type Backend } from '@entole/core/backend';
import type { PaymentsGateway } from '@entole/core/gateway';
import { createOnChainGateway } from '@entole/core/onchain-gateway';
import type { EntoleKeyAccount } from '@entole/core/passkey';
import { encodePaymentCode } from '@entole/core/payment-code';
import { createRecords } from '@entole/core/records';
import { createEnsureGas, createRelayClient } from '@entole/core/relay-client';

import type { SignedInAccount } from './account';
import { deviceRecordStore } from './records-store';

type ExtraConfig = {
  contractAddress?: string;
  tokenAddress?: string;
  routerAddress?: string;
  /** Origin of the sponsor server (`/api/relay`, `/api/faucet`). */
  apiBase?: string;
  growthVaultAddress?: string;
  rpcUrl?: string;
  chainId?: number;
  indexerUrl?: string;
};

const extra = (Constants.expoConfig?.extra?.entole ?? {}) as ExtraConfig;

const CONTRACT_ADDRESS = (extra.contractAddress ?? '0xd0c1099827e49C07f264927d0Dd3416eb29EA9b7') as Address;
const TOKEN_ADDRESS = (extra.tokenAddress ?? '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC') as Address;
/** Left unset (empty string in app.json) until `GrowthVault` is deployed —
 * see contracts/README.md's Status section. `undefined` here is what makes
 * `depositGrow`/`withdrawGrow` fail loudly instead of pretending to settle. */
const ROUTER_ADDRESS = extra.routerAddress ? (extra.routerAddress as Address) : undefined;
const API_BASE = extra.apiBase ?? 'https://entole.vercel.app';
const GROWTH_VAULT_ADDRESS = extra.growthVaultAddress ? (extra.growthVaultAddress as Address) : undefined;
const RPC_URL = extra.rpcUrl ?? 'https://testnet-rpc.monad.xyz';
const CHAIN_ID = extra.chainId ?? 10143;
/** Empty until `indexer/` is actually running — see indexer/README.md. */
const INDEXER_URL = extra.indexerUrl || undefined;
/** `MockERC20` ("eUSD") decimals — see contracts/README.md. Update when
 * Agora AUSD or USDC replaces it (Phase 6). */
const TOKEN_DECIMALS = 6;

/** One live-rate provider for the whole app, so every screen shares the cache. */
const getRate = createRateProvider();
const relay = createRelayClient({ baseUrl: API_BASE });

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
  quoteSend: () => Promise.reject(new Error('Not signed in yet')),
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

/**
 * Builds the real `PaymentsGateway` once an owner + session account exist.
 * `demoGateway.loadSnapshot` backs `loadOffChainSnapshot` here deliberately
 * — see `OnChainGatewayConfig`'s own doc comment in `onchain-gateway.ts`:
 * everything the contract doesn't own (contacts, the payment request,
 * activity history) has nowhere else to come from until Phase 5 (Envio) and
 * a real backend for seats/invoices exist. Settlement itself — the part
 * that actually moves money — always goes through the live contract/token
 * below, never through `demoGateway`.
 */
/** What the gateway needs to know about the assistant. Kept to plain values and
 * one stable function so enabling it (or lazily loading its key) rebuilds the
 * gateway at most once, never on every key change. */
export type AssistantForGateway = {
  enabled: boolean;
  address: Address | null;
  ensureKey: () => Promise<EntoleKeyAccount>;
};

export function useOnChainBackend(
  account: SignedInAccount | null,
  assistant: AssistantForGateway,
): { gateway: PaymentsGateway; backend: Backend } {
  const owner = account?.owner ?? null;
  const { enabled, address, ensureKey } = assistant;

  return useMemo(() => {
    if (!owner) return { gateway: pendingGateway, backend: pendingBackend };

    const records = createRecords(deviceRecordStore, owner.viemAccount.address);
    const source = createAccountSource({ records, getRate });
    const publicClient = createPublicClient({ chain: monadTestnet, transport: http(RPC_URL) });
    const ownerWalletClient = createWalletClient({
      account: owner.viemAccount,
      chain: monadTestnet,
      transport: http(RPC_URL),
    });

    // The assistant's key is only fetched when something assistant-shaped
    // (creating an allowance's delegate, running an allowance-gated payment)
    // actually needs it; everything else signs with the owner key alone.
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

    const gateway = createOnChainGateway({
      publicClient,
      ownerWalletClient,
      ...(enabled && address ? { delegateAddress: address, getDelegateWalletClient } : {}),
      policyAddress: CONTRACT_ADDRESS,
      tokenAddress: TOKEN_ADDRESS,
      ...(GROWTH_VAULT_ADDRESS ? { growthVaultAddress: GROWTH_VAULT_ADDRESS } : {}),
      tokenDecimals: TOKEN_DECIMALS,
      getRate,
      ...(ROUTER_ADDRESS ? { routerAddress: ROUTER_ADDRESS, relay } : {}),
      records,
      ensureGas: createEnsureGas({ getBalance: (address) => publicClient.getBalance({ address }), relay }),
      resolveRecipient: source.resolveRecipient,
      loadOffChainSnapshot: source.loadSnapshot,
      ...(INDEXER_URL ? { indexerUrl: INDEXER_URL, resolveContactId: source.resolveContactId } : {}),
    });
    const backend: Backend = { source, relay, paymentCode: encodePaymentCode(owner.viemAccount.address) };
    return { gateway, backend };
  }, [owner, enabled, address, ensureKey]);
}
