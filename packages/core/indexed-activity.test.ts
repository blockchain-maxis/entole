import { keccak256, toHex, type Address } from 'viem';
import { describe, expect, it } from 'vitest';

import { mapExecutionToActivity, type IndexedExecution } from './indexed-activity';
import type { Allowance } from './schemas';

const RECIPIENT: Address = '0x1111111111111111111111111111111111111111'.slice(0, 42) as Address;
const OTHER: Address = '0x2222222222222222222222222222222222222222'.slice(0, 42) as Address;

const ALLOWANCE: Allowance = {
  id: 'a-mom',
  name: 'Monthly transfer to Mom',
  recipientId: 'c-mom',
  limitMinor: 10_000_000,
  spentMinor: 5_000_000,
  perRunMinor: 5_000_000,
  cadence: 'monthly',
  resetsAt: '2026-10-01T00:00:00.000+01:00',
  paused: false,
};

function execution(overrides: Partial<IndexedExecution> = {}): IndexedExecution {
  return {
    id: '0xabc-0',
    allowance_id: keccak256(toHex('a-mom')),
    recipient: RECIPIENT,
    amountMinor: '5000000', // 6-decimal token minor units
    timestamp: '1758240000', // 2025-09-19T00:00:00Z-ish, exact value doesn't matter
    txHash: '0xabc',
    ...overrides,
  };
}

const OPTIONS = {
  knownAllowances: [ALLOWANCE],
  resolveContactId: (address: Address) => (address.toLowerCase() === RECIPIENT.toLowerCase() ? 'c-mom' : undefined),
  tokenDecimals: 6,
  rate: { koboPerDollar: 158_000, quotedAt: '2026-09-19T00:00:00.000+01:00' },
};

describe('mapExecutionToActivity', () => {
  it('maps a resolvable execution to a settled, assistant-initiated activity entry', () => {
    const entry = mapExecutionToActivity(execution(), OPTIONS);
    expect(entry).not.toBeNull();
    expect(entry).toMatchObject({
      id: '0xabc-0',
      contactId: 'c-mom',
      note: 'Monthly transfer to Mom',
      direction: 'out',
      initiatedBy: 'assistant',
      state: 'settled',
      allowanceId: 'a-mom',
    });
  });

  it('converts token minor units into naira minor units via the given rate', () => {
    const entry = mapExecutionToActivity(execution({ amountMinor: '5000000' }), OPTIONS);
    // 5,000,000 token-minor at 6 decimals = $5.00 -> naira minor at 158,000 kobo/$ = 790,000
    expect(entry?.amountMinor).toBe(790_000);
  });

  it('returns null for a recipient outside the address book', () => {
    const entry = mapExecutionToActivity(execution({ recipient: OTHER }), OPTIONS);
    expect(entry).toBeNull();
  });

  it('returns null for an allowance id that matches no known allowance', () => {
    const entry = mapExecutionToActivity(execution({ allowance_id: keccak256(toHex('a-unknown')) }), OPTIONS);
    expect(entry).toBeNull();
  });
});
