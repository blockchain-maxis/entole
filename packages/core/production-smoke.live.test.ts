import { createPublicClient, createWalletClient, http, type Address, type Chain } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';

import { createAccountSource } from './account-snapshot';
import { createRateProvider } from './fx';
import { createOnChainGateway, ERC20_ABI } from './onchain-gateway';
import { createRecords, type RecordStore } from './records';
import { createEnsureGas, createRelayClient } from './relay-client';

/**
 * The deployed server, exercised the way the apps use it: a brand-new account
 * asks it for test money, then sends some of it to another account with one
 * signature and no fee balance. Everything a passkey and a screen would do,
 * minus the passkey and the screen.
 *
 * Off by default: it uses the deployment's own sponsor and the shared test
 * faucet, which has a cooldown. Run after a deploy with:
 *
 *   ENTOLE_LIVE_API=https://entole.vercel.app \
 *     pnpm --filter @entole/core exec vitest run production-smoke.live
 */
const API = process.env.ENTOLE_LIVE_API?.replace(/\/$/, '');

const RPC = process.env.ENTOLE_LIVE_RPC ?? 'https://testnet-rpc.monad.xyz';
const chain: Chain = {
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
};
const POLICY = '0xEE9C2cE4FC3a58f88D3E2FCE9807cDcA3A97Ed3e' as Address;
const TOKEN = '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC' as Address;
const ROUTER = '0x26dfd3aa7601B57d8b7BB9e9555f5Bdac60dAB01' as Address;
const VAULT = '0x9D904c6a9231F16913ad3A41563dCB07bF9d89bd' as Address;

function memory(): RecordStore {
  const map = new Map<string, string>();
  return {
    get: async (key) => map.get(key) ?? null,
    set: async (key, value) => void map.set(key, value),
    remove: async (key) => void map.delete(key),
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe.skipIf(!API)('live: the deployed server funds and relays for a new account', () => {
  it('adds test money, then settles a send the account never paid a fee for', { timeout: 240_000 }, async () => {
    const payer = privateKeyToAccount(generatePrivateKey());
    const recipient = privateKeyToAccount(generatePrivateKey()).address;
    const transport = http(RPC, { timeout: 30_000, retryCount: 4 });
    const publicClient = createPublicClient({ chain, transport });
    const payerClient = createWalletClient({ account: payer, chain, transport });
    const relay = createRelayClient({ baseUrl: API! });

    const tokenBalance = (owner: Address) =>
      publicClient.readContract({ address: TOKEN, abi: ERC20_ABI, functionName: 'balanceOf', args: [owner] });

    // 1. Test money, through the deployed faucet route.
    await relay.requestFunds(payer.address);
    let funded = 0n;
    for (let attempt = 0; attempt < 40 && funded === 0n; attempt += 1) {
      await sleep(1500);
      funded = await tokenBalance(payer.address).catch(() => 0n);
    }
    expect(funded, 'test money never arrived').toBeGreaterThan(0n);

    // 2. A send, relayed by the deployed sponsor.
    const records = createRecords(memory(), payer.address);
    const getRate = createRateProvider();
    const source = createAccountSource({ records, getRate });
    await source.saveBeneficiary({
      id: 'b-smoke',
      name: 'Smoke Recipient',
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
      relay,
      ensureGas: createEnsureGas({ getBalance: (address) => publicClient.getBalance({ address }), relay }),
      resolveRecipient: source.resolveRecipient,
      loadOffChainSnapshot: source.loadSnapshot,
    });

    const before = await gateway.loadSnapshot();
    const amountMinor = Math.floor(before.account.balanceMinor / 10);
    const quote = await gateway.quoteSend(amountMinor);
    const started = Date.now();
    const receipt = await gateway.submitPayment({ contactId: 'b-smoke', amountMinor, note: 'Production smoke' });
    const seconds = (Date.now() - started) / 1000;

    expect(receipt.feeMinor).toBe(quote.feeMinor);
    expect(await tokenBalance(recipient)).toBeGreaterThan(0n);
    // The whole point: the account never held anything to pay a fee with.
    expect(await publicClient.getBalance({ address: payer.address })).toBe(0n);

    const after = await gateway.loadSnapshot();
    expect(after.account.balanceMinor).toBeLessThan(before.account.balanceMinor);
    console.info(
      `smoke: funded ₦${(before.account.balanceMinor / 100).toFixed(2)}, sent ₦${(amountMinor / 100).toFixed(2)} ` +
        `(fee ₦${(receipt.feeMinor / 100).toFixed(2)}), submit-to-settled ${seconds.toFixed(1)}s from this machine`,
    );
  });

  it('lets the assistant pay inside an allowance and refuses it past the limit', { timeout: 420_000 }, async () => {
    const owner = privateKeyToAccount(generatePrivateKey());
    const assistant = privateKeyToAccount(generatePrivateKey());
    const recipient = privateKeyToAccount(generatePrivateKey()).address;
    const transport = http(RPC, { timeout: 30_000, retryCount: 4 });
    const publicClient = createPublicClient({ chain, transport });
    const relay = createRelayClient({ baseUrl: API! });

    const tokenBalance = (holder: Address) =>
      publicClient.readContract({ address: TOKEN, abi: ERC20_ABI, functionName: 'balanceOf', args: [holder] });

    // Test money for the owner. The shared faucet has a cooldown, so wait it out.
    for (let attempt = 0; ; attempt += 1) {
      try {
        await relay.requestFunds(owner.address);
        break;
      } catch (error) {
        if (attempt >= 12) throw error;
        await sleep(10_000);
      }
    }
    let funded = 0n;
    for (let attempt = 0; attempt < 40 && funded === 0n; attempt += 1) {
      await sleep(1500);
      funded = await tokenBalance(owner.address).catch(() => 0n);
    }
    expect(funded, 'test money never arrived').toBeGreaterThan(0n);

    const records = createRecords(memory(), owner.address);
    const getRate = createRateProvider();
    const source = createAccountSource({ records, getRate });
    await source.saveBeneficiary({
      id: 'b-smoke',
      name: 'Smoke Recipient',
      address: recipient,
      tone: 1,
      createdAt: new Date().toISOString(),
    });
    const gateway = createOnChainGateway({
      publicClient,
      ownerWalletClient: createWalletClient({ account: owner, chain, transport }),
      delegateWalletClient: createWalletClient({ account: assistant, chain, transport }),
      policyAddress: POLICY,
      tokenAddress: TOKEN,
      routerAddress: ROUTER,
      tokenDecimals: 6,
      getRate,
      records,
      relay,
      ensureGas: createEnsureGas({ getBalance: (address) => publicClient.getBalance({ address }), relay }),
      resolveRecipient: source.resolveRecipient,
      loadOffChainSnapshot: source.loadSnapshot,
    });

    // The apps always load the account first; that is also what reads the rate.
    await gateway.loadSnapshot();

    // ₦10,000 a run, ₦20,000 a month: two runs fit, a third does not.
    const perRunMinor = 1_000_000;
    const allowance = await gateway.saveAllowance({
      name: 'Smoke allowance',
      recipientId: 'b-smoke',
      perRunMinor,
      limitMinor: 2 * perRunMinor,
      cadence: 'monthly',
    });

    const run = (amountMinor: number) =>
      gateway.submitPayment({ contactId: 'b-smoke', amountMinor, allowanceId: allowance.id });

    await run(perRunMinor);
    const afterOne = await tokenBalance(recipient);
    expect(afterOne, 'the first run paid nothing').toBeGreaterThan(0n);

    // More than one run may carry: refused, and nothing moves.
    const tooBig = await run(perRunMinor + 100_000).then(
      () => null,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(tooBig, 'a run over the per-run limit went through').not.toBeNull();
    expect(await tokenBalance(recipient)).toBe(afterOne);

    await run(perRunMinor);
    const afterTwo = await tokenBalance(recipient);
    expect(afterTwo).toBeGreaterThan(afterOne);

    // The month is spent: the contract refuses a third.
    const overLimit = await run(perRunMinor).then(
      () => null,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(overLimit, 'a run past the monthly limit went through').not.toBeNull();
    expect(await tokenBalance(recipient)).toBe(afterTwo);

    // The assistant's key never held anything to pay a fee with.
    const assistantFeeBalance = await publicClient.getBalance({ address: assistant.address });
    console.info(
      `smoke: allowance ${allowance.id.slice(0, 10)}… two runs settled; over a run: "${tooBig}"; ` +
        `past the limit: "${overLimit}"; assistant fee balance ${assistantFeeBalance}`,
    );
    expect(assistantFeeBalance).toBe(0n);
  });

  it('moves money into savings and back out, and the balance follows', { timeout: 420_000 }, async () => {
    const owner = privateKeyToAccount(generatePrivateKey());
    const transport = http(RPC, { timeout: 30_000, retryCount: 4 });
    const publicClient = createPublicClient({ chain, transport });
    const relay = createRelayClient({ baseUrl: API! });

    for (let attempt = 0; ; attempt += 1) {
      try {
        await relay.requestFunds(owner.address);
        break;
      } catch (error) {
        if (attempt >= 12) throw error;
        await sleep(10_000);
      }
    }
    let funded = 0n;
    for (let attempt = 0; attempt < 40 && funded === 0n; attempt += 1) {
      await sleep(1500);
      funded = await publicClient
        .readContract({ address: TOKEN, abi: ERC20_ABI, functionName: 'balanceOf', args: [owner.address] })
        .catch(() => 0n);
    }
    expect(funded, 'test money never arrived').toBeGreaterThan(0n);

    const records = createRecords(memory(), owner.address);
    const getRate = createRateProvider();
    const source = createAccountSource({ records, getRate });
    const gateway = createOnChainGateway({
      publicClient,
      ownerWalletClient: createWalletClient({ account: owner, chain, transport }),
      policyAddress: POLICY,
      tokenAddress: TOKEN,
      routerAddress: ROUTER,
      growthVaultAddress: VAULT,
      tokenDecimals: 6,
      getRate,
      records,
      relay,
      ensureGas: createEnsureGas({ getBalance: (address) => publicClient.getBalance({ address }), relay }),
      resolveRecipient: source.resolveRecipient,
      loadOffChainSnapshot: source.loadSnapshot,
    });

    const before = await gateway.loadSnapshot();
    const amountMinor = 5_000_000; // ₦50,000

    const saved = await gateway.depositGrow(amountMinor);
    const afterDeposit = await gateway.loadSnapshot();
    expect(saved.balanceMinor).toBeGreaterThan(0);
    expect(afterDeposit.account.balanceMinor).toBeLessThan(before.account.balanceMinor);

    const withdrawn = await gateway.withdrawGrow(Math.floor(amountMinor / 2));
    const afterWithdraw = await gateway.loadSnapshot();
    expect(withdrawn.balanceMinor).toBeLessThan(saved.balanceMinor);
    expect(afterWithdraw.account.balanceMinor).toBeGreaterThan(afterDeposit.account.balanceMinor);

    console.info(
      `smoke: savings ₦${(saved.balanceMinor / 100).toFixed(2)} after adding ₦${(amountMinor / 100).toFixed(2)}, ` +
        `₦${(withdrawn.balanceMinor / 100).toFixed(2)} after taking half out; earned shown ₦${(saved.accruedMinor / 100).toFixed(2)}; ` +
        `next payout shown ${saved.nextPayoutAt}`,
    );
  });
});
