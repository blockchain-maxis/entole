import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  parseEther,
  type Address,
  type Chain,
  type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';

import { createAccountSource } from './account-snapshot';
import { createOnChainGateway, ERC20_ABI } from './onchain-gateway';
import { createRecords, type RecordStore } from './records';

/**
 * Savings against the real thing: Aave's AUSD vault as it is on Monad mainnet,
 * on a local copy of the chain, driven through the same gateway the apps use.
 * Nothing is spent and nothing is mocked except the clock.
 *
 * Off by default. Start a copy of mainnet, then point this at it:
 *
 *   anvil --fork-url https://rpc.monad.xyz --port 8546
 *   ENTOLE_FORK_RPC=http://127.0.0.1:8546 \
 *     pnpm --filter @entole/core exec vitest run savings.fork
 */
const RPC = process.env.ENTOLE_FORK_RPC;

const AUSD = '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a' as Address;
/** Aave's AUSD deposit token: it holds the market's idle AUSD, so it can fund a test account. */
const AAVE_AUSD = '0xdeBFeDF35faEd5d1664E553545e144C02227A2Ec' as Address;
/** "Wrapped Aave Monad AUSD" (AUSD_STATA_TOKEN in Aave's address book). */
const SAVINGS_VAULT = '0x9e1AcC5BFbf34e2E579763cE14042d957719fE76' as Address;
const AAVE_DATA_PROVIDER = '0xB65A68B98274ef7D9a60E0C0747dD1BEc3D32fad' as Address;
/** Anywhere will do: the policy is not on mainnet yet, so its code is placed here for the test. */
const POLICY = '0x00000000000000000000000000000000000e1701' as Address;

const chain: Chain = {
  id: 143,
  name: 'Monad (local copy)',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [RPC ?? 'http://127.0.0.1:8546'] } },
};

/** One cent at the test's rate, rounded up: the most that rounding can move a figure. */
const CENT_IN_KOBO = 1_400;

function memory(): RecordStore {
  const map = new Map<string, string>();
  return {
    get: async (key) => map.get(key) ?? null,
    set: async (key, value) => void map.set(key, value),
    remove: async (key) => void map.delete(key),
  };
}

describe.skipIf(!RPC)('fork: savings earn in Aave through the gateway', () => {
  it('goes in, is worth more a month later, and comes back out with what it earned', { timeout: 300_000 }, async () => {
    const transport = http(RPC!, { timeout: 60_000, retryCount: 3 });
    const publicClient = createPublicClient({ chain, transport });
    const test = createTestClient({ chain, mode: 'anvil', transport });
    const saver = privateKeyToAccount(generatePrivateKey());

    // A funded account: fee balance set directly, dollars sent from Aave's own idle pool.
    await test.setBalance({ address: saver.address, value: parseEther('5') });
    await test.setBalance({ address: AAVE_AUSD, value: parseEther('5') });
    await test.impersonateAccount({ address: AAVE_AUSD });
    const funder = createWalletClient({ account: AAVE_AUSD, chain, transport });
    const fundHash = await funder.writeContract({
      address: AUSD,
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [saver.address, 1_000_000_000n],
    });
    await publicClient.waitForTransactionReceipt({ hash: fundHash });
    await test.stopImpersonatingAccount({ address: AAVE_AUSD });

    // The policy contract's real code, so the account can be read as the apps read it.
    const artifact = JSON.parse(
      readFileSync(join(__dirname, '../../contracts/out/EntolePolicy.sol/EntolePolicy.json'), 'utf8'),
    ) as { deployedBytecode: { object: Hex } };
    await test.setCode({ address: POLICY, bytecode: artifact.deployedBytecode.object });

    const records = createRecords(memory(), saver.address);
    const rate = { koboPerDollar: 133_101, quotedAt: new Date().toISOString() };
    const source = createAccountSource({ records, getRate: async () => rate });
    const gateway = createOnChainGateway({
      publicClient,
      ownerWalletClient: createWalletClient({ account: saver, chain, transport }),
      policyAddress: POLICY,
      tokenAddress: AUSD,
      tokenDecimals: 6,
      rate,
      records,
      savingsVault: { address: SAVINGS_VAULT, rateProvider: AAVE_DATA_PROVIDER },
      resolveRecipient: source.resolveRecipient,
      loadOffChainSnapshot: source.loadSnapshot,
    });

    const dollars = (owner: Address) =>
      publicClient.readContract({ address: AUSD, abi: ERC20_ABI, functionName: 'balanceOf', args: [owner] });

    const start = await gateway.loadSnapshot();
    expect(start.growPosition?.balanceMinor).toBe(0);
    // The rate is read from Aave itself. Sanity bounds, not a fixed figure.
    expect(start.growPosition?.ratePerYearBps).toBeGreaterThan(10);
    expect(start.growPosition?.ratePerYearBps).toBeLessThan(5_000);

    // In: ₦500,000.
    const putMinor = 50_000_000;
    const saved = await gateway.depositGrow(putMinor);
    // Naira is turned into whole cents on the way in, so it lands within a cent's worth.
    expect(saved.balanceMinor).toBeGreaterThan(putMinor - CENT_IN_KOBO);
    expect(saved.balanceMinor).toBeLessThanOrEqual(putMinor + CENT_IN_KOBO);
    expect(saved.accruedMinor).toBe(0);
    const afterDeposit = await gateway.loadSnapshot();
    expect(afterDeposit.account.balanceMinor).toBeLessThan(start.account.balanceMinor);

    // A month of borrowers paying interest.
    await test.increaseTime({ seconds: 30 * 24 * 60 * 60 });
    await test.mine({ blocks: 1 });
    const monthLater = await gateway.loadSnapshot();
    expect(monthLater.growPosition!.balanceMinor).toBeGreaterThan(saved.balanceMinor);
    expect(monthLater.growPosition!.accruedMinor).toBeGreaterThan(0);
    // What it earned is exactly how much more it is worth, to within a kobo of rounding.
    const grewBy = monthLater.growPosition!.balanceMinor - saved.balanceMinor;
    expect(Math.abs(monthLater.growPosition!.accruedMinor - grewBy)).toBeLessThanOrEqual(2);

    // Half out: the rest keeps its share of what was earned.
    const half = Math.floor(monthLater.growPosition!.balanceMinor / 2);
    const afterHalf = await gateway.withdrawGrow(half);
    expect(afterHalf.balanceMinor).toBeGreaterThan(half - CENT_IN_KOBO);
    expect(afterHalf.balanceMinor).toBeLessThan(half + CENT_IN_KOBO);
    expect(afterHalf.accruedMinor).toBeGreaterThan(0);
    expect(afterHalf.accruedMinor).toBeLessThan(monthLater.growPosition!.accruedMinor);

    // Everything out, asked for with room to spare: all of it, nothing left behind.
    const empty = await gateway.withdrawGrow(afterHalf.balanceMinor * 2);
    expect(empty.balanceMinor).toBe(0);
    expect(empty.accruedMinor).toBe(0);
    expect(await dollars(saver.address)).toBeGreaterThan(1_000_000_000n);

    console.info(
      `fork: ₦${(putMinor / 100).toLocaleString()} in at ${(start.growPosition!.ratePerYearBps! / 100).toFixed(2)}% a year; ` +
        `a month later ₦${(monthLater.growPosition!.balanceMinor / 100).toLocaleString()} ` +
        `(₦${(monthLater.growPosition!.accruedMinor / 100).toFixed(2)} earned); ` +
        `all out, account holds ${(Number(await dollars(saver.address)) / 1e6).toFixed(6)} dollars against 1000 at the start`,
    );
  });
});
