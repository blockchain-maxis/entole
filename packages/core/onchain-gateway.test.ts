import { describe, expect, it, vi } from 'vitest';
import type { Address, PublicClient, WalletClient } from 'viem';

import { DEMO_RATE } from './fx';
import { demoGateway } from './gateway';
import { AssistantNotEnabledError, createOnChainGateway } from './onchain-gateway';

/**
 * The assistant is opt-in. Until it is turned on the gateway has no assistant
 * key at all, so everything assistant-shaped must refuse cleanly and everything
 * the person does themselves must keep working on the owner key alone.
 */

const HASH = `0x${'ab'.repeat(32)}` as const;
const ADDRESS = `0x${'11'.repeat(20)}` as Address;
const ASSISTANT = `0x${'22'.repeat(20)}` as Address;

function walletClient() {
  const writeContract = vi.fn().mockResolvedValue(HASH);
  const client = {
    chain: { id: 1 },
    account: { address: ADDRESS },
    writeContract,
  } as unknown as WalletClient;
  return { client, writeContract };
}

function build(extra: Partial<Parameters<typeof createOnChainGateway>[0]> = {}) {
  const owner = walletClient();
  const publicClient = {
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ transactionHash: HASH }),
    readContract: vi.fn(),
  } as unknown as PublicClient;
  const gateway = createOnChainGateway({
    publicClient,
    ownerWalletClient: owner.client,
    policyAddress: ADDRESS,
    tokenAddress: ADDRESS,
    tokenDecimals: 6,
    rate: DEMO_RATE,
    resolveRecipient: () => ADDRESS,
    loadOffChainSnapshot: demoGateway.loadSnapshot,
    ...extra,
  });
  return { gateway, owner };
}

const draft = {
  name: 'Rent',
  recipientId: 'anyone',
  perRunMinor: 1_000_00,
  limitMinor: 5_000_00,
  cadence: 'monthly',
} as const;

describe('with the assistant off', () => {
  it('refuses to create an allowance', async () => {
    const { gateway, owner } = build();
    await expect(gateway.saveAllowance(draft)).rejects.toBeInstanceOf(AssistantNotEnabledError);
    expect(owner.writeContract).not.toHaveBeenCalled();
  });

  it('refuses an allowance-gated payment', async () => {
    const { gateway } = build();
    await expect(
      gateway.submitPayment({ contactId: 'c', amountMinor: 1_000_00, allowanceId: 'a-1' }),
    ).rejects.toBeInstanceOf(AssistantNotEnabledError);
  });

  it('still lets the person pay directly, signed by the owner alone', async () => {
    const { gateway, owner } = build();
    const receipt = await gateway.submitPayment({ contactId: 'c', amountMinor: 1_000_00 });
    expect(receipt.amountMinor).toBe(1_000_00);
    expect(owner.writeContract).toHaveBeenCalledTimes(1);
  });
});

describe('with the assistant on but its key not loaded yet', () => {
  it('creates an allowance from the saved address without asking for the key', async () => {
    const getDelegateWalletClient = vi.fn();
    const { gateway, owner } = build({ delegateAddress: ASSISTANT, getDelegateWalletClient });
    await gateway.saveAllowance(draft);
    expect(owner.writeContract).toHaveBeenCalledTimes(1);
    expect(getDelegateWalletClient).not.toHaveBeenCalled();
  });

  it('asks for the key only when an allowance-gated payment needs it, and signs with it', async () => {
    const delegate = walletClient();
    const getDelegateWalletClient = vi.fn().mockResolvedValue(delegate.client);
    const { gateway, owner } = build({ delegateAddress: ASSISTANT, getDelegateWalletClient });

    await gateway.submitPayment({ contactId: 'c', amountMinor: 1_000_00 });
    expect(getDelegateWalletClient).not.toHaveBeenCalled();

    await gateway.submitPayment({ contactId: 'c', amountMinor: 1_000_00, allowanceId: 'a-1' });
    expect(getDelegateWalletClient).toHaveBeenCalledTimes(1);
    expect(delegate.writeContract).toHaveBeenCalledTimes(1);
    expect(owner.writeContract).toHaveBeenCalledTimes(1);
  });
});
