import { createPublicClient, createWalletClient, http, type Address, type Chain, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';

import { createAccountSource } from './account-snapshot';
import { createRateProvider } from './fx';
import { createOnChainGateway, ERC20_ABI } from './onchain-gateway';
import { createRecords, type RecordStore } from './records';

/**
 * Runs the real send path against Monad testnet and the real Agora AUSD — the
 * one place a signature format mistake would show up. Off by default (it spends
 * a little testnet gas from a funded key); run with:
 *
 *   set -a; . contracts/.env; set +a
 *   ENTOLE_LIVE=1 pnpm --filter @entole/core exec vitest run onchain-gateway.live
 *
 * A funded key (DEPLOYER_PRIVATE_KEY) stands in for the sponsor server: it
 * pays the gas and submits what the payer signed, exactly as `/api/relay` does.
 */
const LIVE = process.env.ENTOLE_LIVE === '1';

const RPC = 'https://testnet-rpc.monad.xyz';
const chain: Chain = {
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
};
const POLICY = '0xd0c1099827e49C07f264927d0Dd3416eb29EA9b7' as Address;
const TOKEN = '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC' as Address;
const ROUTER = '0x26dfd3aa7601B57d8b7BB9e9555f5Bdac60dAB01' as Address;
const AGORA_FAUCET = '0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C' as Address;

const ROUTER_PAY_ABI = [
  {
    type: 'function',
    name: 'pay',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'salt', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const;
const FAUCET_ABI = [
  {
    type: 'function',
    name: 'requestFunds',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'to', type: 'address' }],
    outputs: [],
  },
] as const;

const memory = (): RecordStore => {
  const data = new Map<string, string>();
  return {
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    remove: async (k) => void data.delete(k),
  };
};

describe.skipIf(!LIVE)('live: single-signature send on Monad testnet', () => {
  it('quotes, signs once, settles atomically, and reports the real balance', async () => {
    const sponsor = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex);
    const payer = privateKeyToAccount(generatePrivateKey());
    const recipient = privateKeyToAccount(generatePrivateKey()).address;

    const publicClient = createPublicClient({ chain, transport: http(RPC) });
    const sponsorClient = createWalletClient({ account: sponsor, chain, transport: http(RPC) });
    const payerClient = createWalletClient({ account: payer, chain, transport: http(RPC) });

    // Fund the payer from Agora's own faucet — the payer itself never holds MON.
    const fundHash = await sponsorClient.writeContract({
      address: AGORA_FAUCET,
      abi: FAUCET_ABI,
      functionName: 'requestFunds',
      args: [payer.address],
    });
    await publicClient.waitForTransactionReceipt({ hash: fundHash });
    expect(await publicClient.getBalance({ address: payer.address })).toBe(0n);

    const records = createRecords(memory(), payer.address);
    const getRate = createRateProvider();
    const source = createAccountSource({ records, getRate });
    await source.saveBeneficiary({
      id: 'b-live',
      name: 'Live Recipient',
      address: recipient,
      tone: 1,
      createdAt: new Date().toISOString(),
    });

    const gateway = createOnChainGateway({
      publicClient,
      ownerWalletClient: payerClient,
      policyAddress: POLICY,
      tokenAddress: TOKEN,
      routerAddress: ROUTER,
      tokenDecimals: 6,
      getRate,
      records,
      resolveRecipient: source.resolveRecipient,
      loadOffChainSnapshot: source.loadSnapshot,
      relay: {
        // Stands in for /api/relay: the sponsor pays gas, the payer's signature does the rest.
        submitPayment: (p) =>
          sponsorClient.writeContract({
            address: ROUTER,
            abi: ROUTER_PAY_ABI,
            functionName: 'pay',
            args: [p.from, p.recipient, p.amount, p.validAfter, p.validBefore, p.salt, p.v, p.r, p.s],
          }),
      },
    });

    const before = await gateway.loadSnapshot();
    expect(before.account.balanceMinor).toBeGreaterThan(0);

    const amountMinor = 100 * 100_000; // ₦100,000-ish in kobo — a few dollars at the live rate
    const quote = await gateway.quoteSend(amountMinor);
    expect(quote.feeMinor).toBeGreaterThan(0);
    expect(quote.totalMinor).toBe(amountMinor + quote.feeMinor);

    const receipt = await gateway.submitPayment({ contactId: 'b-live', amountMinor, note: 'Live test' });
    expect(receipt.feeMinor).toBe(quote.feeMinor);

    const received = await publicClient.readContract({
      address: TOKEN,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [recipient],
    });
    expect(received).toBeGreaterThan(0n);

    const after = await gateway.loadSnapshot();
    expect(after.account.balanceMinor).toBeLessThan(before.account.balanceMinor);
    expect(after.activity.map((a) => a.note)).toContain('Live test');
    expect(await publicClient.getBalance({ address: payer.address })).toBe(0n); // never needed gas
  }, 120_000);
});
