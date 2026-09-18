import Constants from 'expo-constants';
import { useMemo } from 'react';
import { createPublicClient, createWalletClient, http, type Address, type Chain } from 'viem';

import { resolveContactId, resolveRecipient } from '@entole/core/address-book';
import { DEMO_RATE } from '@entole/core/fx';
import { demoGateway, type PaymentsGateway } from '@entole/core/gateway';
import { createOnChainGateway } from '@entole/core/onchain-gateway';

import type { SignedInAccount } from './account';

type ExtraConfig = {
  contractAddress?: string;
  tokenAddress?: string;
  growthVaultAddress?: string;
  rpcUrl?: string;
  chainId?: number;
  indexerUrl?: string;
};

const extra = (Constants.expoConfig?.extra?.entole ?? {}) as ExtraConfig;

const CONTRACT_ADDRESS = (extra.contractAddress ?? '0xd0c1099827e49C07f264927d0Dd3416eb29EA9b7') as Address;
const TOKEN_ADDRESS = (extra.tokenAddress ?? '0xaca20A081Ab69148E291e65dcf4f69Ef9B0674A6') as Address;
/** Left unset (empty string in app.json) until `GrowthVault` is deployed —
 * see contracts/README.md's Status section. `undefined` here is what makes
 * `depositGrow`/`withdrawGrow` fail loudly instead of pretending to settle. */
const GROWTH_VAULT_ADDRESS = extra.growthVaultAddress ? (extra.growthVaultAddress as Address) : undefined;
const RPC_URL = extra.rpcUrl ?? 'https://testnet-rpc.monad.xyz';
const CHAIN_ID = extra.chainId ?? 10143;
/** Empty until `indexer/` is actually running — see indexer/README.md. */
const INDEXER_URL = extra.indexerUrl || undefined;
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
  depositGrow: () => Promise.reject(new Error('Not signed in yet')),
  withdrawGrow: () => Promise.reject(new Error('Not signed in yet')),
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
export function useOnChainGateway(account: SignedInAccount | null): PaymentsGateway {
  return useMemo(() => {
    if (!account) return pendingGateway;

    const publicClient = createPublicClient({ chain: monadTestnet, transport: http(RPC_URL) });
    const ownerWalletClient = createWalletClient({
      account: account.owner.viemAccount,
      chain: monadTestnet,
      transport: http(RPC_URL),
    });
    const delegateWalletClient = createWalletClient({
      account: account.session.viemAccount,
      chain: monadTestnet,
      transport: http(RPC_URL),
    });

    return createOnChainGateway({
      publicClient,
      ownerWalletClient,
      delegateWalletClient,
      policyAddress: CONTRACT_ADDRESS,
      tokenAddress: TOKEN_ADDRESS,
      ...(GROWTH_VAULT_ADDRESS ? { growthVaultAddress: GROWTH_VAULT_ADDRESS } : {}),
      tokenDecimals: TOKEN_DECIMALS,
      rate: DEMO_RATE,
      resolveRecipient,
      loadOffChainSnapshot: demoGateway.loadSnapshot,
      ...(INDEXER_URL ? { indexerUrl: INDEXER_URL, resolveContactId } : {}),
    });
  }, [account]);
}
