import { describe, expect, it, vi } from 'vitest';
import type { Address, PublicClient, WalletClient } from 'viem';

import { DEMO_RATE } from './fx';
import { demoGateway } from './gateway';
import {
  AssistantNotEnabledError,
  SavingsBusyError,
  createOnChainGateway,
  describeRevert,
} from './onchain-gateway';
import { createRecords } from './records';

/**
 * The assistant is opt-in. Until it is turned on the gateway has no assistant
 * key at all, so everything assistant-shaped must refuse cleanly and everything
 * the person does themselves must keep working on the owner key alone.
 */

const HASH = `0x${'ab'.repeat(32)}` as const;
const ADDRESS = `0x${'11'.repeat(20)}` as Address;
const ASSISTANT = `0x${'22'.repeat(20)}` as Address;

const SIGNATURE = `0x${'cd'.repeat(65)}` as const;

function walletClient() {
  const writeContract = vi.fn().mockResolvedValue(HASH);
  const signTypedData = vi.fn().mockResolvedValue(SIGNATURE);
  const client = {
    chain: { id: 1 },
    account: { address: ADDRESS },
    writeContract,
    signTypedData,
  } as unknown as WalletClient;
  return { client, writeContract, signTypedData };
}

function build(extra: Partial<Parameters<typeof createOnChainGateway>[0]> = {}) {
  const owner = walletClient();
  const publicClient = {
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ transactionHash: HASH }),
    // Allowance, nonce and "would this run be refused" all read as zero/false.
    readContract: vi.fn().mockResolvedValue(0n),
    getChainId: vi.fn().mockResolvedValue(1),
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
  return { gateway, owner, publicClient };
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
    expect(owner.writeContract).toHaveBeenCalledTimes(2); // approve, then create
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

describe('an allowance can actually pay', () => {
  it('approves the policy before creating the allowance, on top of what is already approved', async () => {
    const { gateway, owner, publicClient } = build({ delegateAddress: ASSISTANT });
    (publicClient.readContract as ReturnType<typeof vi.fn>).mockResolvedValue(7n);

    await gateway.saveAllowance(draft);

    const names = owner.writeContract.mock.calls.map(([call]) => call.functionName);
    expect(names).toEqual(['approve', 'createAllowance']);
    const approval = owner.writeContract.mock.calls[0]![0] as { args: [Address, bigint] };
    expect(approval.args[0]).toBe(ADDRESS);
    // 24 monthly periods of the cap, plus the 7 already approved.
    expect(approval.args[1]).toBeGreaterThan(7n);
  });

  it('approves a single period for an on-request allowance', async () => {
    const monthly = build({ delegateAddress: ASSISTANT });
    const onRequest = build({ delegateAddress: ASSISTANT });
    await monthly.gateway.saveAllowance(draft);
    await onRequest.gateway.saveAllowance({ ...draft, cadence: 'on-request' });
    const amount = (b: typeof monthly) =>
      (b.owner.writeContract.mock.calls[0]![0] as { args: [Address, bigint] }).args[1];
    expect(amount(monthly)).toBe(amount(onRequest) * 24n);
  });

  it('tells the inbox which allowance to charge, and survives it being down', async () => {
    const onAllowanceChanged = vi.fn().mockRejectedValue(new Error('down'));
    const { gateway } = build({ delegateAddress: ASSISTANT, onAllowanceChanged });
    const saved = await gateway.saveAllowance(draft);
    expect(onAllowanceChanged).toHaveBeenCalledWith(saved.id);
    await gateway.revokeAllowance(saved.id);
    expect(onAllowanceChanged).toHaveBeenLastCalledWith(null);
  });
});

describe('the assistant pays through the sponsor', () => {
  const run = { contactId: 'c', amountMinor: 1_000_00, allowanceId: 'a-1' };

  it('signs the run with its own key and lets the sponsor submit it', async () => {
    const delegate = walletClient();
    const submitExecute = vi.fn().mockResolvedValue(HASH);
    const submitPayment = vi.fn();
    const { gateway } = build({
      delegateAddress: ASSISTANT,
      getDelegateWalletClient: vi.fn().mockResolvedValue(delegate.client),
      relay: { submitPayment, submitExecute },
    });

    await gateway.submitPayment(run);

    expect(delegate.signTypedData).toHaveBeenCalledTimes(1);
    expect(delegate.writeContract).not.toHaveBeenCalled();
    expect(submitExecute).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: ADDRESS, signature: SIGNATURE, amount: expect.any(BigInt) }),
    );
  });

  it('pays for itself, topped up first, when the sponsor route is not there', async () => {
    const delegate = walletClient();
    const ensureGas = vi.fn().mockResolvedValue(undefined);
    const submitExecute = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'not_configured' }));
    const { gateway } = build({
      delegateAddress: ASSISTANT,
      getDelegateWalletClient: vi.fn().mockResolvedValue(delegate.client),
      relay: { submitPayment: vi.fn(), submitExecute },
      ensureGas,
    });

    await gateway.submitPayment(run);

    expect(ensureGas).toHaveBeenCalledWith(ADDRESS);
    expect(delegate.writeContract).toHaveBeenCalledTimes(1);
  });

  it('pays for itself against a policy contract from before executeFor (no nonce to read)', async () => {
    const delegate = walletClient();
    const submitExecute = vi.fn();
    const { gateway, publicClient } = build({
      delegateAddress: ASSISTANT,
      getDelegateWalletClient: vi.fn().mockResolvedValue(delegate.client),
      relay: { submitPayment: vi.fn(), submitExecute },
      ensureGas: vi.fn().mockResolvedValue(undefined),
    });
    (publicClient.readContract as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ functionName }: { functionName: string }) => {
        if (functionName === 'nonces') throw new Error('execution reverted');
        return 0n;
      },
    );

    await gateway.submitPayment(run);
    expect(submitExecute).not.toHaveBeenCalled();
    expect(delegate.writeContract).toHaveBeenCalledTimes(1);
  });

  it('also falls back when the sponsor could not run it at all', async () => {
    const delegate = walletClient();
    const submitExecute = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'rejected' }));
    const { gateway } = build({
      delegateAddress: ASSISTANT,
      getDelegateWalletClient: vi.fn().mockResolvedValue(delegate.client),
      relay: { submitPayment: vi.fn(), submitExecute },
      ensureGas: vi.fn().mockResolvedValue(undefined),
    });
    await gateway.submitPayment(run);
    expect(delegate.writeContract).toHaveBeenCalledTimes(1);
  });

  it('does not retry on its own key when the sponsor refused the run', async () => {
    const delegate = walletClient();
    const submitExecute = vi.fn().mockRejectedValue(Object.assign(new Error('Over.'), { code: 'over_limit' }));
    const { gateway } = build({
      delegateAddress: ASSISTANT,
      getDelegateWalletClient: vi.fn().mockResolvedValue(delegate.client),
      relay: { submitPayment: vi.fn(), submitExecute },
    });

    await expect(gateway.submitPayment(run)).rejects.toThrow('Over.');
    expect(delegate.writeContract).not.toHaveBeenCalled();
  });

  it('refuses before sending anything when the contract would refuse the run', async () => {
    const delegate = walletClient();
    const submitExecute = vi.fn();
    const { gateway, publicClient } = build({
      delegateAddress: ASSISTANT,
      getDelegateWalletClient: vi.fn().mockResolvedValue(delegate.client),
      relay: { submitPayment: vi.fn(), submitExecute },
    });
    (publicClient.readContract as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    await expect(gateway.submitPayment(run)).rejects.toThrow(/outside what the assistant can do/);
    expect(submitExecute).not.toHaveBeenCalled();
    expect(delegate.writeContract).not.toHaveBeenCalled();
  });

  it('turns a contract refusal into plain words', async () => {
    const delegate = walletClient();
    delegate.writeContract.mockRejectedValue(new Error('execution reverted: OverPeriodCap()'));
    const { gateway } = build({
      delegateAddress: ASSISTANT,
      getDelegateWalletClient: vi.fn().mockResolvedValue(delegate.client),
    });
    await expect(gateway.submitPayment(run)).rejects.toThrow("That's more than the assistant has left to spend.");
  });
});

describe('describeRevert', () => {
  it('never leaks the raw error', () => {
    expect(describeRevert(new Error('0xdeadbeef raw rpc text')).message).toBe(
      "That payment didn't go through. Nothing was taken.",
    );
  });
});

describe('seats are real records, not the demo', () => {
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

  const seatDraft = {
    name: 'Travel and supplies',
    contactId: 'ada',
    role: 'officer',
    perRunMinor: 5_000_00,
    limitMinor: 50_000_00,
    cadence: 'monthly',
  } as const;

  it('keeps a seat, and it is there on the next read', async () => {
    const records = memoryRecords();
    const { gateway } = build({ records });
    const seat = await gateway.saveSeat(seatDraft);
    expect(seat).toMatchObject({ name: 'Travel and supplies', spentMinor: 0, paused: false });
    expect(new Date(seat.resetsAt).getTime()).toBeGreaterThan(Date.now());
    expect(await records.seats.list()).toEqual([seat]);
  });

  it('keeps what a seat has spent when it is edited, and replaces it rather than adding another', async () => {
    const records = memoryRecords();
    const { gateway } = build({ records });
    const seat = await gateway.saveSeat(seatDraft);
    await records.seats.upsert({ ...seat, spentMinor: 12_000_00, paused: true });

    const edited = await gateway.saveSeat({ ...seatDraft, id: seat.id, limitMinor: 80_000_00 });
    expect(edited).toMatchObject({ id: seat.id, limitMinor: 80_000_00, spentMinor: 12_000_00, paused: true });
    expect(await records.seats.list()).toHaveLength(1);
  });

  it('gives an on-request seat a real date, not an overflowed one', async () => {
    const { gateway } = build({ records: memoryRecords() });
    const seat = await gateway.saveSeat({ ...seatDraft, cadence: 'on-request' });
    expect(Number.isNaN(new Date(seat.resetsAt).getTime())).toBe(false);
  });

  it('removes a revoked seat, and says so when there is nowhere to keep them', async () => {
    const records = memoryRecords();
    const { gateway } = build({ records });
    const seat = await gateway.saveSeat(seatDraft);
    await gateway.revokeSeat(seat.id);
    expect(await records.seats.list()).toEqual([]);
    await expect(build().gateway.saveSeat(seatDraft)).rejects.toThrow(/can't be saved on this device/);
  });
});

describe('savings in a vault that pays', () => {
  const VAULT = `0x${'55'.repeat(20)}` as Address;
  const RATES = `0x${'66'.repeat(20)}` as Address;
  // At the demo rate, ₦158,000 is exactly $100.
  const HUNDRED_DOLLARS_KOBO = 15_800_000;
  const DOLLAR = 1_000_000n;

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

  /** A chain where the vault holds `shares` worth `value`, and `available` can leave. */
  function buildSavings(state: { shares: bigint; value: bigint; available?: bigint; rate?: bigint | 'fails' }) {
    const records = memoryRecords();
    const { gateway, owner, publicClient } = build({
      records,
      savingsVault: { address: VAULT, rateProvider: RATES },
      // No allowances, so reading the account asks the chain only about money.
      loadOffChainSnapshot: async () => ({ ...(await demoGateway.loadSnapshot()), allowances: [], growPosition: null }),
    });
    (publicClient.readContract as ReturnType<typeof vi.fn>).mockImplementation(
      async (call: { address: Address; functionName: string }) => {
        if (/paused/i.test(call.functionName)) return false;
        if (call.address === VAULT && call.functionName === 'balanceOf') return state.shares;
        if (call.functionName === 'convertToAssets') return state.value;
        if (call.functionName === 'maxWithdraw') return state.available ?? state.value;
        if (call.functionName === 'getReserveData') {
          if (state.rate === 'fails') throw new Error('rate source down');
          const row = Array<bigint>(12).fill(0n);
          row[5] = state.rate ?? 33_000_000_000_000_000_000_000_000n; // 3.3% a year
          return row;
        }
        return 0n;
      },
    );
    return { gateway, owner, records, state };
  }

  it('reads the real value, the rate, and no earnings on a device that never saw money go in', async () => {
    const { gateway } = buildSavings({ shares: 99n * DOLLAR, value: 100n * DOLLAR });
    const { growPosition } = await gateway.loadSnapshot();
    expect(growPosition).toMatchObject({ balanceMinor: HUNDRED_DOLLARS_KOBO, accruedMinor: 0, ratePerYearBps: 330 });
  });

  it('counts as earnings only what is above what the person put in', async () => {
    const { gateway, records } = buildSavings({ shares: 99n * DOLLAR, value: 100n * DOLLAR });
    await records.savings.setPrincipal(98n * DOLLAR);
    const { growPosition } = await gateway.loadSnapshot();
    expect(growPosition?.accruedMinor).toBe(316_000); // $2 at ₦1,580
  });

  it('still shows the balance when the rate cannot be read, and shows no rate', async () => {
    const { gateway } = buildSavings({ shares: DOLLAR, value: DOLLAR, rate: 'fails' });
    const { growPosition } = await gateway.loadSnapshot();
    expect(growPosition?.balanceMinor).toBe(158_000);
    expect(growPosition?.ratePerYearBps).toBeUndefined();
  });

  it('puts money in from the person’s own account, to their own name, and remembers how much', async () => {
    const { gateway, owner, records } = buildSavings({ shares: 0n, value: 0n });
    await gateway.loadSnapshot();
    await gateway.depositGrow(HUNDRED_DOLLARS_KOBO);

    const calls = owner.writeContract.mock.calls.map(([call]) => call as { functionName: string; address: Address; args: unknown[] });
    expect(calls.map((call) => call.functionName)).toEqual(['approve', 'deposit']);
    expect(calls[0]!.args).toEqual([VAULT, 100n * DOLLAR]);
    expect(calls[1]).toMatchObject({ address: VAULT, args: [100n * DOLLAR, ADDRESS] });
    expect(await records.savings.principal()).toBe(100n * DOLLAR);
  });

  it('takes part out with the vault’s withdraw, leaving the rest its share of what went in', async () => {
    const { gateway, owner, records } = buildSavings({ shares: 99n * DOLLAR, value: 100n * DOLLAR });
    await records.savings.setPrincipal(90n * DOLLAR);
    await gateway.loadSnapshot();
    await gateway.withdrawGrow(HUNDRED_DOLLARS_KOBO / 4); // $25

    const call = owner.writeContract.mock.calls[0]![0] as { functionName: string; args: unknown[] };
    expect(call.functionName).toBe('withdraw');
    expect(call.args).toEqual([25n * DOLLAR, ADDRESS, ADDRESS]);
    // Three quarters of the money is left, so three quarters of what went in.
    expect(await records.savings.principal()).toBe((90n * DOLLAR * 75n) / 100n);
  });

  it('takes everything out by redeeming every share, even when asked for a little too much', async () => {
    const { gateway, owner, records } = buildSavings({ shares: 99n * DOLLAR, value: 100n * DOLLAR });
    await records.savings.setPrincipal(90n * DOLLAR);
    await gateway.loadSnapshot();
    await gateway.withdrawGrow(HUNDRED_DOLLARS_KOBO + 5_000);

    const call = owner.writeContract.mock.calls[0]![0] as { functionName: string; args: unknown[] };
    expect(call.functionName).toBe('redeem');
    expect(call.args).toEqual([99n * DOLLAR, ADDRESS, ADDRESS]);
    expect(await records.savings.principal()).toBe(0n);
  });

  it('says so in plain words, before anything is signed, when too much of the vault is lent out', async () => {
    const { gateway, owner } = buildSavings({ shares: 99n * DOLLAR, value: 100n * DOLLAR, available: 10n * DOLLAR });
    await gateway.loadSnapshot();
    const refusal = await gateway.withdrawGrow(HUNDRED_DOLLARS_KOBO / 2).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(SavingsBusyError);
    expect((refusal as Error).message).toMatch(/can't be taken out of savings right now/);
    expect(owner.writeContract).not.toHaveBeenCalled();
  });
});
