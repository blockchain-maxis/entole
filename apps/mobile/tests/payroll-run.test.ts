import { describe, expect, it } from 'vitest';

import {
  affordability,
  isNotEnough,
  lineProblem,
  peopleWords,
  planTotals,
  runPayroll,
  summarise,
  unsettled,
  type PayState,
  type RunLine,
} from '../lib/payroll-run';

const rate = { koboPerDollar: 158_000, quotedAt: '2026-09-20T09:00:00.000Z' };
const line = (id: string, amountMinor: number): RunLine => ({ id, name: `Person ${id}`, code: `PAY-${id}`, amountMinor });

describe('each line is checked against the same per-payment limits as a send', () => {
  it('needs an amount, at least $1 and at most $10,000', () => {
    expect(lineProblem(0, rate)).toBe('Set an amount');
    expect(lineProblem(-5, rate)).toBe('Set an amount');
    expect(lineProblem(1.5, rate)).toBe('Set an amount');
    expect(lineProblem(157_999, rate)).toBe('At least ₦1,580 ($1.00)');
    expect(lineProblem(158_000, rate)).toBeNull();
    expect(lineProblem(1_580_000_000, rate)).toBeNull();
    expect(lineProblem(1_580_000_001, rate)).toBe('At most ₦15,800,000 ($10,000)');
  });
});

describe('totals and fees', () => {
  const lines = [line('a', 5_000_000), line('b', 5_000_000), line('c', 7_500_000)];

  it('adds the real pay, and shows no fee until every fee is known', () => {
    expect(planTotals(lines, null)).toEqual({ payMinor: 17_500_000, feeMinor: null, totalMinor: null });
    // The fee for 5,000,000 is known but not the one for 7,500,000: no half-sum.
    expect(planTotals(lines, new Map([[5_000_000, 100]]))).toEqual({
      payMinor: 17_500_000,
      feeMinor: null,
      totalMinor: null,
    });
  });

  it('sums the fee of every line, so two equal amounts pay two fees', () => {
    const fees = new Map([
      [5_000_000, 100],
      [7_500_000, 150],
    ]);
    expect(planTotals(lines, fees)).toEqual({ payMinor: 17_500_000, feeMinor: 350, totalMinor: 17_500_350 });
  });

  it('checks total plus fees against the balance', () => {
    expect(affordability(null, 100)).toEqual({ state: 'unknown' });
    expect(affordability(100, 100)).toEqual({ state: 'enough' });
    expect(affordability(101, 100)).toEqual({ state: 'short', shortByMinor: 1 });
  });
});

describe('the runner pays one at a time and never shows a state early', () => {
  it('goes waiting -> paying -> settled in order, one payment in flight at a time', async () => {
    const lines = [line('a', 1), line('b', 2), line('c', 3)];
    const events: string[] = [];
    let inFlight = 0;
    let peak = 0;
    const outcome = await runPayroll({
      lines,
      send: async (l) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        events.push(`send ${l.id}`);
        await Promise.resolve();
        inFlight -= 1;
        return { id: `rc-${l.id}`, feeMinor: 10 };
      },
      onState: (id, state) => events.push(`${id}:${state.status}`),
    });
    expect(outcome).toEqual({ stoppedForBalance: false });
    expect(peak).toBe(1);
    expect(events).toEqual([
      'a:paying', 'send a', 'a:settled',
      'b:paying', 'send b', 'b:settled',
      'c:paying', 'send c', 'c:settled',
    ]);
  });

  it('is not settled while the payment is still pending', async () => {
    const states: Record<string, PayState> = {};
    let release: (value: { id: string; feeMinor: number }) => void = () => {};
    const pending = new Promise<{ id: string; feeMinor: number }>((resolve) => (release = resolve));
    const run = runPayroll({
      lines: [line('a', 1)],
      send: () => pending,
      onState: (id, state) => void (states[id] = state),
    });
    await Promise.resolve();
    expect(states.a).toEqual({ status: 'paying' });
    release({ id: 'rc-a', feeMinor: 5 });
    await run;
    expect(states.a).toEqual({ status: 'settled', receiptId: 'rc-a', feeMinor: 5 });
  });

  it('marks a failure with its plain message and carries on with everyone else', async () => {
    const states: Record<string, PayState> = {};
    const outcome = await runPayroll({
      lines: [line('a', 1), line('b', 2), line('c', 3)],
      send: async (l) => {
        if (l.id === 'b') throw new Error("That payment didn't go through. Nothing was taken.");
        return { id: `rc-${l.id}`, feeMinor: 1 };
      },
      onState: (id, state) => void (states[id] = state),
    });
    expect(outcome.stoppedForBalance).toBe(false);
    expect(states.a?.status).toBe('settled');
    expect(states.b).toEqual({ status: 'failed', message: "That payment didn't go through. Nothing was taken." });
    expect(states.c?.status).toBe('settled');
  });

  it('never lets a technical message reach the screen', async () => {
    const states: Record<string, PayState> = {};
    await runPayroll({
      lines: [line('a', 1)],
      send: async () => {
        throw new Error('HTTP 500 from https://relay.example/api/relay 0xabcdef123456');
      },
      onState: (id, state) => void (states[id] = state),
    });
    expect(states.a).toEqual({ status: 'failed', message: "That payment didn't go through. Nothing was taken." });
  });

  it('stops cleanly when the money runs out and leaves the rest waiting', async () => {
    const states: Record<string, PayState> = {};
    const sent: string[] = [];
    const lines = [line('a', 1), line('b', 2), line('c', 3)];
    const outcome = await runPayroll({
      lines,
      send: async (l) => {
        sent.push(l.id);
        if (l.id === 'b') throw new Error("You don't have enough for this payment and its fee.");
        return { id: `rc-${l.id}`, feeMinor: 1 };
      },
      onState: (id, state) => void (states[id] = state),
    });
    expect(outcome).toEqual({ stoppedForBalance: true });
    expect(sent).toEqual(['a', 'b']);
    expect(states.c).toBeUndefined();
    expect(states.b).toMatchObject({ status: 'failed' });
    // "Retry" pays exactly the failed one and the ones never reached.
    expect(unsettled(lines, states).map((l) => l.id)).toEqual(['b', 'c']);
  });

  it('recognises running out of money by the gateway wording', () => {
    expect(isNotEnough(new Error("You don't have enough for this payment and its fee."))).toBe(true);
    expect(isNotEnough(new Error('That is more than your balance of ₦5.'))).toBe(true);
    expect(isNotEnough(new Error('The network is busy'))).toBe(false);
    expect(isNotEnough('enough')).toBe(false);
  });
});

describe('the summary', () => {
  it('counts only what really settled, with its real fees', () => {
    const lines = [line('a', 1_000), line('b', 2_000), line('c', 3_000), line('d', 4_000)];
    const states: Record<string, PayState> = {
      a: { status: 'settled', receiptId: 'r1', feeMinor: 10 },
      b: { status: 'failed', message: 'x' },
      c: { status: 'settled', receiptId: 'r3', feeMinor: 30 },
      d: { status: 'paying' },
    };
    expect(summarise(lines, states)).toEqual({ settled: 2, failed: 1, waiting: 1, paidMinor: 4_000, feeMinor: 40 });
  });

  it('says people in the singular for one', () => {
    expect(peopleWords(1)).toBe('1 person');
    expect(peopleWords(5)).toBe('5 people');
  });
});
