import { describe, expect, it } from 'vitest';

import { createAccountSource } from './account-snapshot';
import { ASK_UNDO_SECONDS, createProposalSlot, emptyProposalSlot, proposeFromRequest } from './assistant-ask';
import { createRecords, type RecordStore } from './records';
import type { Allowance, Contact } from './schemas';

const ada: Contact = { id: 'c-ada', name: 'Ada Obi', initials: 'AO', tone: 1 };
const tunde: Contact = { id: 'c-tunde', name: 'Tunde Bello', initials: 'TB', tone: 2 };

const allowance = (overrides: Partial<Allowance> = {}): Allowance => ({
  id: 'a-1',
  name: 'Rent',
  recipientId: ada.id,
  limitMinor: 2_000_000,
  spentMinor: 0,
  perRunMinor: 1_000_000,
  cadence: 'monthly',
  resetsAt: '2026-11-01T00:00:00.000+01:00',
  paused: false,
  ...overrides,
});

const account = { contacts: [ada, tunde], allowances: [allowance()] };

describe('proposeFromRequest', () => {
  it('turns a sentence into a proposal on the allowance for that person', () => {
    const result = proposeFromRequest('Pay 5000 to Ada for rent', account, { now: () => 1_000 });
    expect(result).toEqual({
      ok: true,
      proposal: {
        id: 'ask-rs',
        allowanceId: 'a-1',
        contactId: 'c-ada',
        amountMinor: 500_000,
        note: 'rent',
        undoSeconds: ASK_UNDO_SECONDS,
      },
    });
  });

  it('says where the request came from when no reason is given', () => {
    const result = proposeFromRequest('send ₦2,500 to ada', account);
    expect(result.ok && result.proposal.note).toBe('Asked in the app');
    expect(result.ok && result.proposal.amountMinor).toBe(250_000);
  });

  it('does not judge the amount: a request past the limit is still proposed, for the contract to refuse', () => {
    const result = proposeFromRequest('Pay 9000000 to Ada', account);
    expect(result.ok && result.proposal.amountMinor).toBe(900_000_000);
  });

  it('refuses in plain words when nobody was named, or the person has no allowance', () => {
    expect(proposeFromRequest('hello', account)).toMatchObject({ ok: false });
    expect(proposeFromRequest('Pay 5000 to Zainab', account)).toEqual({
      ok: false,
      reason: 'You haven\'t saved anyone called "Zainab" yet.',
    });
    expect(proposeFromRequest('Pay 5000 to Tunde', account)).toEqual({
      ok: false,
      reason: 'The assistant has no allowance for Tunde yet. Set one up first.',
    });
  });

  it('will not propose on a paused allowance, but uses another one for the same person', () => {
    const paused = { contacts: [ada], allowances: [allowance({ paused: true })] };
    expect(proposeFromRequest('Pay 5000 to Ada', paused)).toEqual({
      ok: false,
      reason: 'The allowance for Ada is paused. Resume it first.',
    });

    const twoRules = { contacts: [ada], allowances: [allowance({ paused: true }), allowance({ id: 'a-2' })] };
    const result = proposeFromRequest('Pay 5000 to Ada', twoRules);
    expect(result.ok && result.proposal.allowanceId).toBe('a-2');
  });
});

describe('proposal slot', () => {
  it('holds one waiting proposal until it is cleared', () => {
    const slot = createProposalSlot();
    expect(slot.read()).toBeNull();
    const result = proposeFromRequest('Pay 5000 to Ada', account);
    if (!result.ok) throw new Error('expected a proposal');
    slot.put(result.proposal);
    expect(slot.read()).toEqual(result.proposal);
    slot.clear();
    expect(slot.read()).toBeNull();
  });

  it('the empty slot keeps nothing', () => {
    const result = proposeFromRequest('Pay 5000 to Ada', account);
    if (!result.ok) throw new Error('expected a proposal');
    emptyProposalSlot.put(result.proposal);
    expect(emptyProposalSlot.read()).toBeNull();
  });
});

describe('a waiting proposal reaches the account the screens read', () => {
  function memory(): RecordStore {
    const map = new Map<string, string>();
    return {
      get: async (key) => map.get(key) ?? null,
      set: async (key, value) => void map.set(key, value),
      remove: async (key) => void map.delete(key),
    };
  }
  const getRate = async () => ({ koboPerDollar: 133_101, quotedAt: '2026-10-10T00:00:00.000Z' });

  it('is the snapshot proposal while it waits, ahead of the server inbox, and gone once cleared', async () => {
    const slot = createProposalSlot();
    let inboxReads = 0;
    const source = createAccountSource({
      records: createRecords(memory(), '0x1111111111111111111111111111111111111111'),
      getRate,
      readProposal: async () => {
        const waiting = slot.read();
        if (waiting) return waiting;
        inboxReads += 1;
        return null;
      },
    });

    expect((await source.loadSnapshot()).proposal).toBeNull();
    expect(inboxReads).toBe(1);

    const result = proposeFromRequest('Pay 5000 to Ada for rent', account);
    if (!result.ok) throw new Error('expected a proposal');
    slot.put(result.proposal);
    expect((await source.loadSnapshot()).proposal).toEqual(result.proposal);
    expect(inboxReads).toBe(1);

    slot.clear();
    expect((await source.loadSnapshot()).proposal).toBeNull();
  });
});
