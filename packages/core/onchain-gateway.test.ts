import { describe, expect, it, vi } from 'vitest';
import type { Address, PublicClient, WalletClient } from 'viem';

import { DEMO_RATE } from './fx';
import { describeMovement, MovementNotConfirmedError } from './movement';
import { demoGateway } from './gateway';
import { oneOffContact } from './one-off';
import {
  AssistantNotEnabledError,
  SavingsBusyError,
  allowanceFigures,
  createOnChainGateway,
  describeRevert,
  whyRefused,
} from './onchain-gateway';
import type { PaymentsFeed, ReceivedPayment } from './payments-feed';
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
    link: 'https://entole.pro/pay/PAY-X?t=invoice',
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

describe('a held invoice, checked against the business’s own records', () => {
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

  const held = {
    clientName: 'Ada Stores',
    amountMinor: 2_500_000,
    note: 'Fabric, 40 yards',
    dueAt: '2026-10-20T00:00:00.000+01:00',
    link: 'https://entole.pro/pay/PAY-TEST',
    // Release once a dollar costs ₦1,500 or less.
    releaseCondition: { type: 'fx-rate-at-or-below', maxKoboPerDollar: 150_000 },
  } as const;
  const at = (koboPerDollar: number) => ({ koboPerDollar, quotedAt: '2026-10-10T00:00:00.000Z' });

  it('stays held, and says so with null, while the rate is worse than asked for', async () => {
    const records = memoryRecords();
    const { gateway } = build({ records });
    const invoice = await gateway.createInvoice(held);
    expect(invoice.status).toBe('pending-release');

    expect(await gateway.requestConditionalRelease(invoice.id, at(158_000))).toBeNull();
    expect((await records.invoices.list())[0]!.status).toBe('pending-release');
  });

  it('is released to be paid once the rate is met: not marked paid, and no reserve invented', async () => {
    const records = memoryRecords();
    const { gateway, owner } = build({ records });
    const invoice = await gateway.createInvoice(held);

    const result = await gateway.requestConditionalRelease(invoice.id, at(149_000));
    expect(result?.invoice.status).toBe('sent');
    expect(result?.invoice.paidAt).toBeUndefined();
    expect(result?.taxReserve).toBeNull();
    expect((await records.invoices.list())[0]!.status).toBe('sent');
    // Releasing a request moves no money.
    expect(owner.writeContract).not.toHaveBeenCalled();
  });

  it('leaves an invoice that was never held exactly as it is', async () => {
    const records = memoryRecords();
    const { gateway } = build({ records });
    const { releaseCondition: _none, ...plain } = held;
    const invoice = await gateway.createInvoice(plain);
    const result = await gateway.requestConditionalRelease(invoice.id, at(100_000));
    expect(result?.invoice).toEqual(invoice);
  });

  it('refuses an invoice it has no record of, instead of looking in sample data', async () => {
    const { gateway } = build({ records: memoryRecords() });
    await expect(gateway.requestConditionalRelease('inv-not-mine', at(100_000))).rejects.toThrow(
      /couldn't find that invoice/,
    );
  });
});

describe('an allowance reads back as the limit that was written', () => {
  // N1,330.17 to the dollar, the rate on the day this was found: N2,000 is
  // $1.50 to the cent, and $1.50 back through the rate is N1,995.26.
  const fromToken = (amount: bigint) => Math.round((Number(amount) / 10_000) * 133_017 / 100);
  const cap = 1_500_000n; // $1.50 with six decimals

  it('shows the written limit, not the one that came back through dollars', () => {
    expect(fromToken(cap)).toBe(1_995_26);
    expect(allowanceFigures(2_000_00, cap, 0n, fromToken)).toEqual({ limitMinor: 2_000_00, spentMinor: 0 });
  });

  it('all of it used reads as nothing left, and half reads as half', () => {
    expect(allowanceFigures(2_000_00, cap, cap, fromToken)).toEqual({ limitMinor: 2_000_00, spentMinor: 2_000_00 });
    expect(allowanceFigures(2_000_00, cap, 750_000n, fromToken)).toEqual({ limitMinor: 2_000_00, spentMinor: 1_000_00 });
  });

  it('never shows more used than the limit', () => {
    expect(allowanceFigures(2_000_00, cap, 1_600_000n, fromToken).spentMinor).toBe(2_000_00);
  });

  it('falls back to the network when the device holds no written figure', () => {
    expect(allowanceFigures(0, cap, 750_000n, fromToken)).toEqual({ limitMinor: 1_995_26, spentMinor: 997_63 });
  });
});

describe('a refused payment says which rule held', () => {
  const NOW = 1_800_000_000n;
  const allowance = {
    perRunMax: 2_000_000n,
    periodCap: 5_000_000n,
    periodSeconds: 2_592_000n,
    periodStart: NOW - 1_000n,
    spentInPeriod: 4_000_000n,
    expiresAt: NOW + 10_000_000n,
    revoked: false,
  };

  it('over what is left for the period', () => {
    expect(whyRefused(allowance, false, 1_500_000n, NOW)).toBe("That's more than the assistant has left to spend.");
  });

  it('over what one payment may be, before the period is even looked at', () => {
    expect(whyRefused(allowance, false, 2_500_000n, NOW)).toBe("That's more than the assistant can spend in one payment.");
  });

  it('paused, whatever the amount', () => {
    expect(whyRefused(allowance, true, 1n, NOW)).toBe('The assistant is paused. Resume it to continue.');
  });

  it('turned off comes before everything else, as it does in the contract', () => {
    expect(whyRefused({ ...allowance, revoked: true }, true, 9_000_000n, NOW)).toBe('That allowance has been turned off.');
  });

  it('expired', () => {
    expect(whyRefused({ ...allowance, expiresAt: NOW - 1n }, false, 1n, NOW)).toBe('That allowance has expired.');
  });

  it('a period that has rolled over starts again from nothing spent', () => {
    const rolled = { ...allowance, periodStart: NOW - 3_000_000n };
    // 4m was spent last period; 1.5m fits a fresh 5m.
    expect(whyRefused(rolled, false, 1_500_000n, NOW)).toBe('That payment is outside what the assistant can do right now.');
  });
});


describe('describing a movement for the confirmation prompt', () => {
  it('says what is about to happen, in naira', () => {
    expect(describeMovement({ kind: 'send', amountMinor: 2_500_00 })).toBe('Send ₦2,500');
    expect(describeMovement({ kind: 'send-many', totalMinor: 150_000_00, count: 3 })).toBe('Pay 3 people ₦150,000');
    expect(describeMovement({ kind: 'send-many', totalMinor: 50_000_00, count: 1 })).toBe('Pay 1 person ₦50,000');
    expect(describeMovement({ kind: 'bill', amountMinor: 3_000_00 })).toBe('Pay a bill of ₦3,000');
    expect(describeMovement({ kind: 'save', amountMinor: 5_000_00 })).toBe('Add ₦5,000 to savings');
    expect(describeMovement({ kind: 'take-out', amountMinor: 5_000_00 })).toBe('Take ₦5,000 out of savings');
    expect(describeMovement({ kind: 'allowance', limitMinor: 100_000_00 })).toBe('Let the assistant spend up to ₦100,000');
  });

  it('a refusal carries words fit to show', () => {
    expect(new MovementNotConfirmedError().message).toBe('Not confirmed. Nothing was moved.');
    expect(new MovementNotConfirmedError('Set up a screen lock first.').name).toBe('MovementNotConfirmedError');
  });
});

describe('the person confirms before their own money moves', () => {
  const refuse = () => vi.fn().mockRejectedValue(new MovementNotConfirmedError());

  it('a send asks first, saying how much, and a refusal signs and sends nothing', async () => {
    const confirmMovement = refuse();
    const { gateway, owner } = build({ confirmMovement });

    await expect(gateway.submitPayment({ contactId: 'c', amountMinor: 1_000_00 })).rejects.toThrow(
      'Not confirmed. Nothing was moved.',
    );
    expect(confirmMovement).toHaveBeenCalledWith({ kind: 'send', amountMinor: 1_000_00 });
    expect(owner.writeContract).not.toHaveBeenCalled();
    expect(owner.signTypedData).not.toHaveBeenCalled();
  });

  it('a confirmed send goes through', async () => {
    const confirmMovement = vi.fn().mockResolvedValue(undefined);
    const { gateway, owner } = build({ confirmMovement });
    await gateway.submitPayment({ contactId: 'c', amountMinor: 1_000_00 });
    expect(confirmMovement).toHaveBeenCalledTimes(1);
    expect(owner.writeContract).toHaveBeenCalledTimes(1);
  });

  it('the assistant\'s run does not ask: the allowance is its limit', async () => {
    const confirmMovement = refuse();
    const delegate = walletClient();
    const { gateway } = build({
      confirmMovement,
      delegateAddress: ASSISTANT,
      getDelegateWalletClient: vi.fn().mockResolvedValue(delegate.client),
      ensureGas: vi.fn().mockResolvedValue(undefined),
    });
    await gateway.submitPayment({ contactId: 'c', amountMinor: 1_000_00, allowanceId: 'a-1' });
    expect(confirmMovement).not.toHaveBeenCalled();
    expect(delegate.writeContract).toHaveBeenCalledTimes(1);
  });

  it('a run of payments is confirmed once, for the people and the total', async () => {
    const confirmMovement = vi.fn().mockResolvedValue(undefined);
    const { gateway, owner } = build({ confirmMovement });
    const batch = { id: 'payroll-1', totalMinor: 3_000_00, count: 3 };
    for (let n = 0; n < 3; n += 1) await gateway.submitPayment({ contactId: 'c', amountMinor: 1_000_00, batch });

    expect(confirmMovement).toHaveBeenCalledTimes(1);
    expect(confirmMovement).toHaveBeenCalledWith({ kind: 'send-many', totalMinor: 3_000_00, count: 3 });
    expect(owner.writeContract).toHaveBeenCalledTimes(3);

    // A new run asks again.
    await gateway.submitPayment({ contactId: 'c', amountMinor: 1_000_00, batch: { ...batch, id: 'payroll-2' } });
    expect(confirmMovement).toHaveBeenCalledTimes(2);
  });

  it('a new allowance asks, with its limit, before anything is approved', async () => {
    const confirmMovement = refuse();
    const { gateway, owner } = build({ confirmMovement, delegateAddress: ASSISTANT });
    await expect(gateway.saveAllowance(draft)).rejects.toThrow('Not confirmed. Nothing was moved.');
    expect(confirmMovement).toHaveBeenCalledWith({ kind: 'allowance', limitMinor: 5_000_00 });
    expect(owner.writeContract).not.toHaveBeenCalled();
  });

  it('savings ask on the way in and on the way out', async () => {
    const confirmMovement = refuse();
    const { gateway, owner } = build({ confirmMovement, growthVaultAddress: ADDRESS });
    await expect(gateway.depositGrow(2_000_00)).rejects.toThrow('Not confirmed. Nothing was moved.');
    await expect(gateway.withdrawGrow(1_000_00)).rejects.toThrow('Not confirmed. Nothing was moved.');
    expect(confirmMovement.mock.calls.map(([movement]) => movement)).toEqual([
      { kind: 'save', amountMinor: 2_000_00 },
      { kind: 'take-out', amountMinor: 1_000_00 },
    ]);
    expect(owner.writeContract).not.toHaveBeenCalled();
  });
});

describe('money that arrives', () => {
  const SENDER = `0x${'33'.repeat(20)}` as Address;
  const IN_HASH = `0x${'ef'.repeat(32)}`;

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

  function received(overrides: Partial<ReceivedPayment> = {}): ReceivedPayment {
    return {
      hash: IN_HASH,
      from: SENDER,
      fromName: 'Ada Eze',
      amountToken: '3160000',
      amountMinor: 500_000,
      at: new Date().toISOString(),
      note: 'For rent',
      ...overrides,
    };
  }

  function feed(list: ReceivedPayment[]): PaymentsFeed & { record: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn> } {
    return { record: vi.fn().mockResolvedValue(true), list: vi.fn().mockResolvedValue(list) };
  }

  /** A gateway whose account reads cleanly from the chain: not paused, nothing held. */
  function arrive(extra: Parameters<typeof build>[0]) {
    const built = build(extra);
    (built.publicClient.readContract as ReturnType<typeof vi.fn>).mockImplementation(
      async (call: { functionName: string }) => (/paused/i.test(call.functionName) ? false : 0n),
    );
    return built;
  }

  /** The account's own records with nothing sent yet, and no demo activity in the way. */
  function quiet(records: ReturnType<typeof memoryRecords>) {
    return async () => ({ ...(await demoGateway.loadSnapshot()), allowances: [], activity: await records.activity.list() });
  }

  it('shows in the receiver’s activity, from the person who sent it, with their note', async () => {
    const records = memoryRecords();
    const { gateway } = arrive({ records, payments: feed([received()]), loadOffChainSnapshot: quiet(records) });

    const snapshot = await gateway.loadSnapshot();
    expect(snapshot.activity).toHaveLength(1);
    const [entry] = snapshot.activity;
    expect(entry).toMatchObject({
      id: `rc-${IN_HASH}`,
      direction: 'in',
      amountMinor: 500_000,
      note: 'For rent',
      state: 'settled',
      initiatedBy: 'you',
    });
    // Named as the directory named them, never by address.
    expect(oneOffContact(entry!.contactId)?.name).toBe('Ada Eze');
    expect(JSON.stringify(oneOffContact(entry!.contactId)?.name)).not.toMatch(/0x/);
  });

  it('is said once: the load that first sees it, and never again', async () => {
    const records = memoryRecords();
    const { gateway } = arrive({ records, payments: feed([received()]), loadOffChainSnapshot: quiet(records) });

    const first = await gateway.loadSnapshot();
    expect(first.arrived?.map((entry) => entry.id)).toEqual([`rc-${IN_HASH}`]);

    const second = await gateway.loadSnapshot();
    expect(second.arrived).toBeUndefined();
    // Still listed, and still the same entry.
    expect(second.activity).toEqual(first.activity);
  });

  it('is kept on the device, so it stays when the server has nothing to say', async () => {
    const records = memoryRecords();
    const payments = feed([received()]);
    const { gateway } = arrive({ records, payments, loadOffChainSnapshot: quiet(records) });
    await gateway.loadSnapshot();

    payments.list.mockRejectedValue(new Error('offline'));
    expect((await gateway.loadSnapshot()).activity).toHaveLength(1);
    expect(await records.activity.list()).toHaveLength(1);
  });

  it('an old payment being caught up on is listed but not announced', async () => {
    const records = memoryRecords();
    const lastWeek = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { gateway } = arrive({ records, payments: feed([received({ at: lastWeek })]), loadOffChainSnapshot: quiet(records) });

    const snapshot = await gateway.loadSnapshot();
    expect(snapshot.activity).toHaveLength(1);
    expect(snapshot.arrived).toBeUndefined();
  });

  it('shows someone already saved under the name they were saved as', async () => {
    const records = memoryRecords();
    const { gateway } = arrive({
      records,
      payments: feed([received()]),
      loadOffChainSnapshot: quiet(records),
      resolveContactId: (address) => (address.toLowerCase() === SENDER.toLowerCase() ? 'b-mum' : undefined),
    });
    expect((await gateway.loadSnapshot()).activity[0]!.contactId).toBe('b-mum');
  });

  it('works the amount out itself when the server could not put a naira figure on it', async () => {
    const records = memoryRecords();
    const { amountMinor: _none, ...bare } = received();
    const { gateway } = arrive({ records, payments: feed([bare]), loadOffChainSnapshot: quiet(records) });
    // 3.16 dollars at the test rate of 1,580 naira.
    expect((await gateway.loadSnapshot()).activity[0]!.amountMinor).toBe(499_280);
  });

  it('a send is reported once it has settled, with the note and what was typed', async () => {
    const payments = feed([]);
    const { gateway } = arrive({ payments });
    await gateway.submitPayment({ contactId: 'c', amountMinor: 500_000, note: 'For rent' });
    expect(payments.record).toHaveBeenCalledWith({
      hash: HASH,
      note: 'For rent',
      amountMinor: 500_000,
      koboPerDollar: DEMO_RATE.koboPerDollar,
    });
  });

  it('a send still completes when the report cannot be made', async () => {
    const payments = feed([]);
    payments.record.mockRejectedValue(new Error('offline'));
    const { gateway } = arrive({ payments });
    await expect(gateway.submitPayment({ contactId: 'c', amountMinor: 500_000 })).resolves.toMatchObject({
      amountMinor: 500_000,
    });
  });

  it('a payment the device sent is not taken for one that arrived', async () => {
    const records = memoryRecords();
    const payments = feed([]);
    const { gateway } = arrive({ records, payments, loadOffChainSnapshot: quiet(records) });
    await gateway.submitPayment({ contactId: 'c', amountMinor: 500_000 });

    // The server hands the same payment back, as it would to someone who paid themselves.
    payments.list.mockResolvedValue([received({ hash: HASH })]);
    const snapshot = await gateway.loadSnapshot();
    expect(snapshot.activity).toHaveLength(1);
    expect(snapshot.activity[0]!.direction).toBe('out');
    expect(snapshot.arrived).toBeUndefined();
  });
});

describe('history from the index', () => {
  const ADA = `0x${'33'.repeat(20)}` as Address;
  const TUNDE = `0x${'44'.repeat(20)}` as Address;
  const SENT = `0x${'a1'.repeat(32)}`;
  const GOT = `0x${'b2'.repeat(32)}`;

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

  const row = (overrides: Record<string, unknown>) => ({
    id: 'x-0',
    from: ADDRESS,
    to: ADA,
    amount: '3160000',
    timestamp: String(Math.floor(Date.now() / 1000) - 86_400 * 3),
    txHash: SENT,
    byAssistant: false,
    ...overrides,
  });

  /** A gateway on a clean chain, reading history from an index that answers with `rows`. */
  function withIndex(rows: unknown[] | 'down', extra: Parameters<typeof build>[0] = {}) {
    const records = memoryRecords();
    const asked = vi.fn(async () =>
      rows === 'down' ? new Response('', { status: 503 }) : new Response(JSON.stringify({ data: { Payment: rows } })),
    );
    vi.stubGlobal('fetch', asked);
    const built = build({
      records,
      indexerUrl: 'https://index.test/v1/graphql',
      loadOffChainSnapshot: async () => ({
        ...(await demoGateway.loadSnapshot()),
        allowances: [],
        activity: await records.activity.list(),
      }),
      ...extra,
    });
    (built.publicClient.readContract as ReturnType<typeof vi.fn>).mockImplementation(
      async (call: { functionName: string }) => (/paused/i.test(call.functionName) ? false : 0n),
    );
    return { ...built, records, asked };
  }

  it('a new phone gets the account’s payments, in and out, with people named', async () => {
    const { gateway, records } = withIndex(
      [row({}), row({ id: 'y-0', from: TUNDE, to: ADDRESS, txHash: GOT, amount: '1000000' })],
      { nameOf: async (address) => (address.toLowerCase() === TUNDE.toLowerCase() ? 'Tunde Bello' : 'Ada Eze') },
    );
    const { activity } = await gateway.loadSnapshot();
    vi.unstubAllGlobals();

    expect(activity.map((entry) => [entry.id, entry.direction, entry.note])).toEqual([
      [`rc-${SENT}`, 'out', 'Sent'],
      [`rc-${GOT}`, 'in', 'Received'],
    ]);
    expect(activity.map((entry) => oneOffContact(entry.contactId)?.name)).toEqual(['Ada Eze', 'Tunde Bello']);
    // Written to the device, so it is there for good.
    expect(await records.activity.list()).toHaveLength(2);
  });

  it('a payment the device already has is not listed twice, and keeps what the device knew', async () => {
    const { gateway, records } = withIndex([row({ txHash: HASH })]);
    await gateway.submitPayment({ contactId: 'c', amountMinor: 500_000, note: 'For rent' });
    const { activity } = await gateway.loadSnapshot();
    vi.unstubAllGlobals();

    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ id: `rc-${HASH}`, note: 'For rent', amountMinor: 500_000 });
    expect(await records.activity.list()).toHaveLength(1);
  });

  it('what the server kept wins over the index: it has the note and the figure that was typed', async () => {
    const payments = {
      record: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue([
        { hash: GOT, from: TUNDE, fromName: 'Tunde Bello', amountToken: '1000000', amountMinor: 160_000, at: new Date().toISOString(), note: 'Fuel' },
      ]),
    };
    const { gateway } = withIndex([row({ id: 'y-0', from: TUNDE, to: ADDRESS, txHash: GOT, amount: '1000000' })], { payments });
    const { activity, arrived } = await gateway.loadSnapshot();
    vi.unstubAllGlobals();

    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ note: 'Fuel', amountMinor: 160_000, direction: 'in' });
    expect(arrived).toHaveLength(1);
  });

  it('a payment that arrived, found only in the index, is still said when it is recent', async () => {
    const now = String(Math.floor(Date.now() / 1000) - 30);
    const { gateway } = withIndex([row({ id: 'y-0', from: TUNDE, to: ADDRESS, txHash: GOT, timestamp: now })]);
    const first = await gateway.loadSnapshot();
    const second = await gateway.loadSnapshot();
    vi.unstubAllGlobals();

    expect(first.arrived?.map((entry) => entry.id)).toEqual([`rc-${GOT}`]);
    expect(second.arrived).toBeUndefined();
    expect(second.activity).toHaveLength(1);
  });

  it('an index that is down leaves the list as it was', async () => {
    const { gateway, asked } = withIndex('down');
    await gateway.submitPayment({ contactId: 'c', amountMinor: 500_000 });
    const { activity } = await gateway.loadSnapshot();
    vi.unstubAllGlobals();

    expect(asked).toHaveBeenCalled();
    expect(activity).toHaveLength(1);
  });

  it('asks only for this account, by its own address', async () => {
    const { gateway, asked } = withIndex([]);
    await gateway.loadSnapshot();
    vi.unstubAllGlobals();
    const body = JSON.parse((asked.mock.calls[0] as unknown as [string, { body: string }])[1].body) as {
      variables: { me: string };
    };
    expect(body.variables.me).toBe(ADDRESS.toLowerCase());
  });
});
