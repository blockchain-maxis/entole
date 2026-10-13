import { createTestIndexer } from 'envio';
import { describe, expect, it } from 'vitest';

/**
 * The handlers, run. Each test hands the real handlers in `src/handlers/` a
 * few events and reads back what they stored, with nothing mocked in between:
 * it is the same code the hosted indexer runs, over events made here instead
 * of fetched.
 *
 * The handler file is not imported here, on purpose. The index finds its
 * handlers by looking in `src/handlers/`, and these tests must find them the
 * same way. Imported by hand, they passed while the deployed index started
 * with no handlers at all and stopped.
 */

const CHAIN = 10143;
const PAYER = '0x26dfd3aa7601b57d8b7bb9e9555f5bdac60dab01' as const;
const PAID = '0xc0d9bc33696d2f5676a1acb1e39d03046405ee80' as const;
const ASSISTANT = '0x1111111111111111111111111111111111111111' as const;
const ALLOWANCE = `0x${'a1'.repeat(32)}`;
const SALT = `0x${'07'.repeat(32)}`;
const hash = (byte: string) => `0x${byte.repeat(32)}`;
/** The policy was deployed after the router; an event of its from before then is not indexed. */
const AFTER_POLICY = 69_700_000;

describe('an ordinary payment', () => {
  it('is kept as who paid, who was paid, what arrived and what it cost', async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            {
              contract: 'EntoleRouter',
              event: 'Paid',
              params: { from: PAYER, recipient: PAID, amount: 3_160_000n, fee: 10_000n, salt: SALT },
              block: { timestamp: 1_760_300_000 },
              transaction: { hash: hash('ab') },
              logIndex: 3,
            },
          ],
        },
      },
    });

    expect(await indexer.Payment.getAll()).toEqual([
      {
        id: `${hash('ab')}-3`,
        from: PAYER,
        to: PAID,
        amount: 3_160_000n,
        fee: 10_000n,
        timestamp: 1_760_300_000n,
        txHash: hash('ab'),
        byAssistant: false,
      },
    ]);
  });

  it('can be found from either end, which is how a person’s history is read', async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            {
              contract: 'EntoleRouter',
              event: 'Paid',
              params: { from: PAYER, recipient: PAID, amount: 1_000_000n, fee: 5_000n, salt: SALT },
              transaction: { hash: hash('01') },
            },
            {
              contract: 'EntoleRouter',
              event: 'Paid',
              params: { from: PAID, recipient: PAYER, amount: 2_000_000n, fee: 5_000n, salt: SALT },
              transaction: { hash: hash('02') },
            },
          ],
        },
      },
    });

    const sentByPayer = await indexer.Payment.getWhere({ from: { _eq: PAYER } });
    const arrivedForPayer = await indexer.Payment.getWhere({ to: { _eq: PAYER } });
    expect(sentByPayer.map((row) => row.amount)).toEqual([1_000_000n]);
    expect(arrivedForPayer.map((row) => row.amount)).toEqual([2_000_000n]);
  });
});

describe('a payment the assistant makes inside an allowance', () => {
  const created = {
    contract: 'EntolePolicy' as const,
    event: 'AllowanceCreated' as const,
    params: { id: ALLOWANCE, owner: PAYER, delegate: ASSISTANT },
    block: { number: AFTER_POLICY },
    transaction: { hash: hash('c1') },
  };
  const executed = {
    contract: 'EntolePolicy' as const,
    event: 'Executed' as const,
    params: { id: ALLOWANCE, recipient: PAID, amount: 1_500_000n },
    block: { number: AFTER_POLICY + 10, timestamp: 1_760_400_000 },
    transaction: { hash: hash('e1') },
    logIndex: 0,
  };

  it('is a payment from the allowance’s owner, marked as the assistant’s', async () => {
    const indexer = createTestIndexer();
    await indexer.process({ chains: { [CHAIN]: { simulate: [created, executed] } } });

    expect(await indexer.Payment.getAll()).toEqual([
      {
        id: `${hash('e1')}-0`,
        from: PAYER,
        to: PAID,
        amount: 1_500_000n,
        fee: 0n,
        timestamp: 1_760_400_000n,
        txHash: hash('e1'),
        byAssistant: true,
      },
    ]);
    // And it stays in the allowance's own history.
    const executions = await indexer.Execution.getAll();
    expect(executions).toHaveLength(1);
    expect(executions[0]).toMatchObject({ allowance_id: ALLOWANCE, recipient: PAID, amountMinor: 1_500_000n });
  });

  it('is not written down as a payment when nobody is known to have made it', async () => {
    const indexer = createTestIndexer();
    await indexer.process({ chains: { [CHAIN]: { simulate: [executed] } } });
    expect(await indexer.Payment.getAll()).toEqual([]);
    expect(await indexer.Execution.getAll()).toHaveLength(1);
  });
});

describe('allowances and pauses', () => {
  it('an allowance is kept, and a revoked one says so', async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            {
              contract: 'EntolePolicy',
              event: 'AllowanceCreated',
              params: { id: ALLOWANCE, owner: PAYER, delegate: ASSISTANT },
              block: { number: AFTER_POLICY },
              transaction: { hash: hash('c1') },
            },
            {
              contract: 'EntolePolicy',
              event: 'AllowanceRevoked',
              params: { id: ALLOWANCE, owner: PAYER },
              block: { number: AFTER_POLICY + 5 },
            },
          ],
        },
      },
    });
    expect(await indexer.Allowance.get(ALLOWANCE)).toMatchObject({ owner: PAYER, delegate: ASSISTANT, revoked: true });
  });

  it('a pause is kept with whose it was', async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            {
              contract: 'EntolePolicy',
              event: 'Paused',
              params: { owner: PAYER, paused: true },
              block: { number: AFTER_POLICY },
              transaction: { hash: hash('f1') },
              logIndex: 0,
            },
          ],
        },
      },
    });
    expect(await indexer.PauseChange.getAll()).toMatchObject([{ owner: PAYER, paused: true }]);
  });
});

describe('a passkey registered for revoking', () => {
  // The two halves of a P-256 public key: 256-bit numbers, kept whole.
  const X = 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n;
  const Y = 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n;

  it('is kept with whose it is, both halves of the key, and when', async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            {
              contract: 'EntolePolicy',
              event: 'PasskeyRegistered',
              params: { owner: PAYER, x: X, y: Y },
              block: { number: AFTER_POLICY, timestamp: 1_760_300_500 },
              transaction: { hash: hash('e1') },
              logIndex: 2,
            },
          ],
        },
      },
    });
    expect(await indexer.PasskeyRegistration.getAll()).toEqual([
      { id: `${hash('e1')}-2`, owner: PAYER, x: X, y: Y, timestamp: 1_760_300_500n },
    ]);
  });

  it('is a new row each time, so an earlier key is not written over', async () => {
    const indexer = createTestIndexer();
    const registered = (byte: string, block: number, x: bigint) => ({
      contract: 'EntolePolicy' as const,
      event: 'PasskeyRegistered' as const,
      params: { owner: PAYER, x, y: Y },
      block: { number: block, timestamp: 1_760_300_000 + block - AFTER_POLICY },
      transaction: { hash: hash(byte) },
      logIndex: 0,
    });
    await indexer.process({
      chains: { [CHAIN]: { simulate: [registered('e2', AFTER_POLICY, X), registered('e3', AFTER_POLICY + 9, X + 1n)] } },
    });
    const rows = await indexer.PasskeyRegistration.getAll();
    expect(rows.map((row) => row.x).sort()).toEqual([X, X + 1n].sort());
    expect(new Set(rows.map((row) => row.owner))).toEqual(new Set([PAYER]));
  });
});
