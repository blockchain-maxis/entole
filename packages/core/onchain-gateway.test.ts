import { describe, expect, it, vi } from 'vitest';
import type { Address, PublicClient, WalletClient } from 'viem';

import { DEMO_RATE } from './fx';
import { demoGateway } from './gateway';
import { AssistantNotEnabledError, createOnChainGateway } from './onchain-gateway';
import { createRecords } from './records';

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

describe('invoices are real records, not the demo', () => {
  function memoryRecords() {
    const data = new Map<string, string>();
    return createRecords(
      {
        get: async (key) => data.get(key) ?? null,
        set: async (key, value) => void data.set(key, value),
        remove: async (key) => void data.delete(key),
      },
      ADDRESS,
    );
  }

  const draft = {
    clientName: ' Bello Foods ',
    amountMinor: 5_000_000,
    note: 'September deliveries',
    dueAt: '2026-10-14T22:59:59.000Z',
    link: 'https://entole.vercel.app/pay/PAY-X?t=invoice',
  };

  it('creates an invoice that is still there on the next load, numbered from 1', async () => {
    const records = memoryRecords();
    const { gateway } = build({ records });
    const first = await gateway.createInvoice(draft);
    const second = await gateway.createInvoice({ ...draft, clientName: 'Ada Stores' });
    expect([first.reference, second.reference]).toEqual(['INV-0001', 'INV-0002']);
    expect(first).toMatchObject({ clientName: 'Bello Foods', status: 'sent', link: draft.link });
    expect((await records.invoices.list()).map((i) => i.reference)).toEqual(['INV-0002', 'INV-0001']);
  });

  it('refuses to reuse an invoice number', async () => {
    const { gateway } = build({ records: memoryRecords() });
    await gateway.createInvoice({ ...draft, reference: 'INV-0001' });
    await expect(gateway.createInvoice({ ...draft, reference: 'INV-0001' })).rejects.toThrow(/already exists/);
  });

  it('marks an invoice paid on request and invents no tax reserve', async () => {
    const records = memoryRecords();
    const { gateway } = build({ records });
    const invoice = await gateway.createInvoice(draft);
    const settled = await gateway.settleInvoice(invoice.id, 0.2);
    expect(settled.taxReserve).toBeNull();
    expect(settled.invoice).toMatchObject({ id: invoice.id, status: 'paid' });
    expect(settled.invoice.paidAt).toBeDefined();
    expect((await records.invoices.list())[0]!.status).toBe('paid');
    // Marking it again changes nothing.
    expect((await gateway.settleInvoice(invoice.id, 0.2)).invoice.paidAt).toBe(settled.invoice.paidAt);
  });

  it('says so when the invoice is not there, or there is nowhere to keep it', async () => {
    const { gateway } = build({ records: memoryRecords() });
    await expect(gateway.settleInvoice('nope', 0.2)).rejects.toThrow("We couldn't find that invoice.");
    await expect(build().gateway.createInvoice(draft)).rejects.toThrow(/can't be saved on this device/);
  });
});
