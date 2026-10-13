/**
 * What each event becomes in the index. Written for HyperIndex 3's
 * `indexer.onEvent`, and run for real by `test/handlers.test.ts`, which feeds
 * these handlers events and reads back what they stored.
 *
 * A handler can only read what `config.yaml` asks for under
 * `field_selection`. A field that is not named there is not fetched, and
 * reading one anyway is a type error: the first version of this file read the
 * payment's hash without asking for it.
 */
import { indexer } from 'envio';

/** An ordinary payment: who paid, who was paid, what arrived, what it cost. */
indexer.onEvent({ contract: 'EntoleRouter', event: 'Paid' }, async ({ event, context }) => {
  context.Payment.set({
    id: `${event.transaction.hash}-${event.logIndex}`,
    from: event.params.from,
    to: event.params.recipient,
    amount: event.params.amount,
    fee: event.params.fee,
    timestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
    byAssistant: false,
  });
});

indexer.onEvent(
  { contract: 'EntolePolicy', event: 'AllowanceCreated' },
  async ({ event, context }) => {
    context.Allowance.set({
      id: event.params.id,
      owner: event.params.owner,
      delegate: event.params.delegate,
      revoked: false,
      createdAtBlock: BigInt(event.block.number),
      createdAtTimestamp: BigInt(event.block.timestamp),
      createdAtTx: event.transaction.hash,
    });
  },
);

indexer.onEvent({ contract: 'EntolePolicy', event: 'AllowanceRevoked' }, async ({ event, context }) => {
  const existing = await context.Allowance.get(event.params.id);
  if (!existing) return;
  context.Allowance.set({ ...existing, revoked: true });
});

/**
 * A payment the assistant made inside an allowance. The event names the
 * allowance and who was paid, not who paid: that is the allowance's owner,
 * read from the allowance this index already holds. It is kept twice. As an
 * `Execution`, tied to its allowance, for the allowance's own history; and as
 * a `Payment`, so the person's history has it beside their ordinary sends.
 */
indexer.onEvent({ contract: 'EntolePolicy', event: 'Executed' }, async ({ event, context }) => {
  const id = `${event.transaction.hash}-${event.logIndex}`;
  const timestamp = BigInt(event.block.timestamp);

  context.Execution.set({
    id,
    allowance_id: event.params.id,
    recipient: event.params.recipient,
    amountMinor: event.params.amount,
    timestamp,
    txHash: event.transaction.hash,
  });

  const allowance = await context.Allowance.get(event.params.id);
  // An allowance made before this index's first block is not known here, and
  // a payment with nobody to say it came from is not written down as one.
  if (!allowance) return;
  context.Payment.set({
    id,
    from: allowance.owner,
    to: event.params.recipient,
    amount: event.params.amount,
    fee: 0n,
    timestamp,
    txHash: event.transaction.hash,
    byAssistant: true,
  });
});

indexer.onEvent({ contract: 'EntolePolicy', event: 'Paused' }, async ({ event, context }) => {
  context.PauseChange.set({
    id: `${event.transaction.hash}-${event.logIndex}`,
    owner: event.params.owner,
    paused: event.params.paused,
    timestamp: BigInt(event.block.timestamp),
  });
});

indexer.onEvent(
  { contract: 'EntolePolicy', event: 'PasskeyRegistered' },
  async ({ event, context }) => {
    context.PasskeyRegistration.set({
      id: `${event.transaction.hash}-${event.logIndex}`,
      owner: event.params.owner,
      x: event.params.x,
      y: event.params.y,
      timestamp: BigInt(event.block.timestamp),
    });
  },
);
